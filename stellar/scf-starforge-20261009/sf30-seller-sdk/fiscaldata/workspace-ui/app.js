// MIT. Browser controls for the retained Fiscal Data model and original publisher.
const $=id=>document.getElementById(id);
const arr=value=>Array.isArray(value)?value:[];
const text=value=>value===null?'null':value===undefined?'':typeof value==='object'?JSON.stringify(value):String(value);
const count=value=>Number.isSafeInteger(value)?value.toLocaleString('en-US'):text(value);
const stamp=value=>value?text(value).replace('T',' ').replace(/\.\d{3}Z$/,' UTC'):'—';
const short=value=>value?text(value).slice(0,12):'—';
const bytes=value=>Number.isSafeInteger(value)?count(value)+' B':'—';
const split=value=>String(value??'').split(',').map(item=>item.trim()).filter(Boolean);
const fieldName=field=>typeof field==='string'?field:field.name??field.source??field.fieldName??'';
function el(tag,attributes={},...children){
  const node=document.createElement(tag);
  for(const [key,value] of Object.entries(attributes)){
    if(value===undefined||value===null)continue;
    if(key==='class')node.className=value;
    else if(key==='dataset')Object.assign(node.dataset,value);
    else if(['value','checked','disabled','hidden','required'].includes(key))node[key]=value;
    else node.setAttribute(key,String(value));
  }
  for(const item of children.flat(Infinity))if(item!==null&&item!==undefined)node.append(item instanceof Node?item:document.createTextNode(text(item)));
  return node;
}
const btn=(label,action,id,disabled=false,kind='secondary')=>el('button',{type:'button',class:kind,dataset:{action,id},disabled},label);
const badge=value=>el('span',{class:'status',dataset:{state:value}},String(value??'').replaceAll('_',' '));
const empty=message=>el('p',{class:'empty'},message);
function notice(message,tone='info'){$('notice').textContent=message;$('notice').dataset.tone=tone;$('notice').hidden=!message;}
function fail(error){notice((error.code?error.code+': ':'')+(error.message||'The operation could not finish.'),'error');}
function metric(entries){return entries.map(([name,value])=>el('dl',{class:'metric'},el('dt',{},name),el('dd',{class:String(value).length>25?'small-value':''},count(value))));}
function table(headings,rows,classes=[]){
  return el('table',{},el('thead',{},el('tr',{},headings.map((name,i)=>el('th',{scope:'col',class:classes[i]??''},name)))),
    el('tbody',{},rows.map(row=>el('tr',{},row.map((value,i)=>el('td',{class:classes[i]??''},value))))));
}
function genericTable(value){
  const rows=Array.isArray(value)?value:value&&typeof value==='object'?Object.entries(value).map(([field,details])=>
    typeof details==='object'&&details!==null&&!Array.isArray(details)?{field,...details}:{field,value:details}):[];
  if(!rows.length)return empty('No records for this selection.');
  const columns=[...new Set(rows.flatMap(row=>row&&typeof row==='object'?Object.keys(row):['value']))];
  return table(columns,rows.map(row=>columns.map(key=>valueNode(typeof row==='object'?row[key]:row))),columns.map(()=>'mono'));
}
function valueNode(value){return value===null?el('span',{class:'value-null'},'null'):value===undefined?'—':text(value);}
function readout(entries){return el('dl',{class:'readout'},entries.flatMap(([name,value])=>[el('dt',{},name),el('dd',{},valueNode(value))]));}
function originalDetails(label,value){return el('details',{class:'details'},el('summary',{},label),el('pre',{},JSON.stringify(value,null,2)));}
function fileLink(kind,id,file){
  const name=typeof file==='string'?file:file.name;
  return el('a',{href:'./api/files/'+[kind,id,name].map(encodeURIComponent).join('/'),download:name,
    title:typeof file==='object'&&file.sha256?'SHA256 '+file.sha256:undefined},name,
    typeof file==='object'&&file.size!==undefined?el('span',{class:'muted'},bytes(file.size)):null);
}
function files(kind,id,items){return el('div',{class:'downloads'},arr(items).map(file=>fileLink(kind,id,file)));}
const cache=new Map();
function update(id,key,render){const encoded=JSON.stringify(key);if(cache.get(id)!==encoded){cache.set(id,encoded);$(id).replaceChildren(...[render()].flat());}}
function select(id,options,preferred){
  const node=$(id);if(!node)return;
  const signature=JSON.stringify(options);
  if(node.dataset.options===signature)return;
  const previous=node.value;
  node.replaceChildren(...options.map(item=>el('option',{value:item.value,disabled:item.disabled},item.label)));
  node.dataset.options=signature;
  if(options.some(item=>item.value===previous&&!item.disabled))node.value=previous;
  else if(options.some(item=>item.value===preferred&&!item.disabled))node.value=preferred;
  else if(options.length)node.value=options.find(item=>!item.disabled)?.value??'';
}
const ui={sourceId:null,sourceRevision:null,sourceDirty:false,sourceDrafts:new Map(),capture:null,captureOffset:0,
  edition:null,editionDirty:false,editionDrafts:new Map(),editionOffset:0,comparison:null,comparisonOffset:0,
  buyerReview:null,detailRequests:{capture:0,edition:0,comparison:0}};
let state=null,sessionToken='',mutation=null,refreshPromise=null,pollTimer=null;
function adopt(next){
  if(!next)return;
  if(next.sessionToken)sessionToken=next.sessionToken;
  if(state&&(next.revision<state.revision||next.revision===state.revision&&next.observedAt<state.observedAt))return;
  state=next;render();
}
async function responseJson(response){
  let result;try{result=await response.json();}catch{throw new Error('The workspace returned an unreadable response. Refresh its retained state.');}
  if(!response.ok)throw Object.assign(new Error(result.message??'The operation could not finish.'),{code:result.code,status:response.status});
  return result;
}
async function action(name,payload={},request=false){
  let requestKey;
  if(request){
    requestKey='fiscaldata.intent.'+name+'.'+JSON.stringify(payload);
    let id;try{id=sessionStorage.getItem(requestKey);}catch{}
    if(!id){id=crypto.randomUUID();try{sessionStorage.setItem(requestKey,id);}catch{}}
    payload={...payload,requestId:id};
  }
  try{
    const result=await responseJson(await fetch('./api/action',{method:'POST',credentials:'same-origin',
      headers:{'content-type':'application/json','x-fiscaldata-session':sessionToken},body:JSON.stringify({action:name,payload})}));
    if(requestKey)try{sessionStorage.removeItem(requestKey);}catch{}
    adopt(result.state);return result.result;
  }catch(error){
    if(requestKey&&error.status&&error.status<500)try{sessionStorage.removeItem(requestKey);}catch{}
    throw error;
  }
}
async function task(label,work,button){
  if(mutation){notice(mutation+' is still running. Its retained progress remains available.');return;}
  mutation=label;const previous=button?.disabled;if(button)button.disabled=true;
  $('main').setAttribute('aria-busy','true');notice(label+'…');
  try{const result=await work();notice(label+' completed.');return result;}
  catch(error){fail(error);try{await refresh();}catch{}}
  finally{mutation=null;if(button?.isConnected)button.disabled=previous??false;$('main').removeAttribute('aria-busy');renderAvailability();}
}
async function refresh(){
  if(refreshPromise)return refreshPromise;
  refreshPromise=(async()=>{
    const result=await responseJson(await fetch('./api/state',{credentials:'same-origin',cache:'no-store'}));adopt(result);
    $('connection').textContent='Connected';$('connection').dataset.state='READY';
  })().finally(()=>{refreshPromise=null;});
  return refreshPromise;
}
function bind(id,event,handler){$(id).addEventListener(event,e=>{if(event==='submit')e.preventDefault();Promise.resolve().then(()=>handler(e)).catch(fail);});}
function render(){
  if(!state)return;
  $('workspace-revision').textContent='Revision '+state.revision+' · '+stamp(state.observedAt);
  $('nav-captures').textContent=count(state.captures.length);
  $('nav-editions').textContent=count(state.editions.length);
  $('nav-comparisons').textContent=count(state.comparisons.length);
  const active=state.captures.find(item=>item.id===state.worker.captureId);
  $('worker-status').textContent=active?active.name:state.worker.running?'Ready for capture':'Idle';
  $('worker-detail').textContent=active?count(active.rows)+' rows · '+count(active.pages)+' pages · '+active.status.toLowerCase():
    'Progress is retained after each source page.';
  $('warnings').hidden=!state.recoveryWarnings.length;
  if(state.recoveryWarnings.length)$('warnings').replaceChildren(...state.recoveryWarnings.map(item=>el('p',{},typeof item==='string'?item:
    [item.code,item.message].filter(Boolean).join(' · ')||JSON.stringify(item))));
  renderSources();renderCaptures();renderEditions();renderComparisons();renderExports();renderPublisher();renderAvailability();
}
function renderSources(){
  update('sources-list',[state.sources,ui.sourceId],()=>state.sources.length?state.sources.map(source=>el('button',{
    type:'button',class:'source-choice','aria-pressed':source.id===ui.sourceId,dataset:{action:'source-open',id:source.id}},
    el('strong',{},source.name),el('span',{class:'muted mono'},source.endpoint),el('span',{class:'muted'},'Revision '+source.revision))):
    empty('Your saved source queries will appear here.'));
  update('endpoints',state.catalog.sha256,()=>arr(state.catalog.endpoints).map(item=>el('option',{value:item.endpoint},
    item.datasetName+' · '+item.tableName)));
  $('catalog-status').textContent=state.catalog.observedAt?count(state.catalog.endpoints.length)+' endpoints · observed '+stamp(state.catalog.observedAt):
    'Discover endpoints from Treasury’s current metadata feed.';
  select('capture-source',state.sources.length?state.sources.map(item=>({value:item.id,label:item.name+' · revision '+item.revision})):
    [{value:'',label:'Save a source first'}],ui.sourceId);
  const source=state.sources.find(item=>item.id===ui.sourceId);
  const probe=source?.lastProbe;
  $('source-probe').hidden=!probe;
  if(probe)update('source-probe',probe.sha256,()=>[
    el('h4',{},'Live field metadata'),el('p',{class:'muted small'},'Observed '+stamp(probe.observedAt)+' · '+arr(probe.sampleRows).length+' sample rows'),
    el('div',{class:'table-wrap section-gap'},genericTable(probe.fields)),
    originalDetails('Retained metadata and source sample',{meta:probe.meta,sampleRows:probe.sampleRows,sha256:probe.sha256})]);
}
function sourceInput(){return {name:$('source-name').value,endpoint:$('source-endpoint').value,filter:$('source-filter').value,
  sort:$('source-sort').value,pageSize:Number($('source-page-size').value),notes:$('source-notes').value};}
function openSource(id,force=false){
  if(ui.sourceDirty&&!force)ui.sourceDrafts.set(ui.sourceId??'new',{...sourceInput(),id:ui.sourceId,revision:ui.sourceRevision});
  const saved=state.sources.find(item=>item.id===id),source=!force&&ui.sourceDrafts.get(id??'new')||saved||{
    name:'',endpoint:'',filter:'',sort:'',pageSize:1000,notes:'',id:null,revision:null};
  ui.sourceId=source.id;ui.sourceRevision=source.revision;ui.sourceDirty=!!(!force&&ui.sourceDrafts.has(id??'new'));
  for(const [suffix,key]of[['name','name'],['endpoint','endpoint'],['filter','filter'],['sort','sort'],['page-size','pageSize'],['notes','notes']])
    $('source-'+suffix).value=source[key]??'';
  $('source-revision').textContent=source.id?'Revision '+source.revision:'New source';
  if(source.id)$('capture-source').value=source.id;renderSources();renderAvailability();
}
function renderCaptures(){
  update('captures-list',state.captures,()=>state.captures.length?table(['Capture','State','Retained progress','Created','Actions'],
    [...state.captures].reverse().map(item=>[
      el('div',{},el('strong',{},item.name),el('small',{class:'muted mono'},short(item.id))),
      el('div',{},badge(item.status),item.error?el('p',{class:'small break'},item.error.message):null),
      el('div',{class:'progress-block'},count(item.rows)+(item.totalRows===null?'':' / '+count(item.totalRows))+' rows',
        el('small',{class:'muted'},count(item.pages)+' pages · '+bytes(item.bytes)),
        item.totalPages?el('progress',{value:item.pages,max:item.totalPages,'aria-label':item.name+' retained pages'}):null),
      stamp(item.createdAt),
      el('div',{class:'row-actions'},btn('Inspect','capture-open',item.id),
        ['RUNNING','QUEUED'].includes(item.status)?btn('Pause','capture-pause',item.id):null,
        ['PAUSED','FAILED'].includes(item.status)?btn('Resume','capture-resume',item.id):null,
        !['COMPLETE','CANCELLED'].includes(item.status)?btn('Cancel','capture-cancel',item.id,false,'quiet'):null)])):
    empty('Start a capture to retain its source pages and progress.'));
}
function renderAvailability(){
  if(!state)return;
  $('probe-source').disabled=!ui.sourceId||ui.sourceDirty||!!mutation;
  $('capture-form').querySelector('button').disabled=!$('capture-source').value||!!mutation;
  $('edition-create-form').querySelector('button').disabled=!$('edition-capture').value||!!mutation;
  $('capture-create-edition').disabled=ui.capture?.status!=='COMPLETE'||!!mutation;
  $('capture-export').disabled=ui.capture?.status!=='COMPLETE'||!!mutation;
  $('save-review').disabled=ui.edition?.status!=='DRAFT'||!!mutation;
  $('build-edition').disabled=ui.edition?.status!=='DRAFT'||ui.editionDirty||!!mutation;
  $('edition-export').disabled=ui.edition?.status!=='READY'||!!mutation;
  $('edition-query-form').querySelector('button').disabled=ui.edition?.status!=='READY'||!!mutation;
  $('merchant-form').querySelector('button').disabled=!$('merchant-edition').value||!!mutation;
}
function showRows(prefix,result,load){
  const rawFields=Array.isArray(result.fields)?result.fields:Object.keys(result.fields??{});
  const fields=rawFields.map(fieldName),rows=arr(result.rows);
  const headings=['Row',...fields];
  const values=rows.map((row,index)=>[row.ordinal??result.offset+index+1,...fields.map((field,i)=>
    valueNode(Array.isArray(row.values)?row.values[i]:(row.values??row)[field]))]);
  $(prefix+'-row-table').replaceChildren(rows.length?table(headings,values,['numeric',...fields.map(()=>'mono')]):empty('No rows in this page.'));
  paginate(prefix+'-row-pagination',result,load);
}
function paginate(id,result,load){
  const offset=result.offset??0,total=result.total??0,length=arr(result.rows).length,next=result.nextOffset;
  const back=btn('Previous','',null,offset===0),forward=btn('Next','',null,next===null||next===undefined);
  back.addEventListener('click',()=>load(Math.max(0,offset-50)).catch(fail));
  forward.addEventListener('click',()=>load(next).catch(fail));
  $(id).replaceChildren(el('span',{},(length?count(offset+1)+'–'+count(offset+length):'0')+' of '+count(total)),back,forward);
}
async function openCapture(id,offset=0){
  const request=++ui.detailRequests.capture;
  const detail=await action('captures.get',{id});
  const rows=await action('captures.rows',{id,offset,limit:50});
  if(request!==ui.detailRequests.capture)return;
  ui.capture=detail;ui.captureOffset=offset;
  $('capture-detail-panel').hidden=false;$('capture-detail-heading').textContent=detail.name;
  $('capture-detail-meta').textContent=detail.status+' · source revision '+detail.sourceRevision+' · '+stamp(detail.createdAt);
  $('capture-detail-summary').replaceChildren(...metric([['Retained rows',detail.rows],['Source pages',detail.pages],
    ['Total reported rows',detail.totalRows??'—'],['Capture bytes',detail.bytes]]));
  $('capture-original').textContent=JSON.stringify(detail,null,2);
  showRows('capture',rows,next=>openCapture(id,next));renderAvailability();
}


function renderEditions(){
  const completed=state.captures.filter(item=>item.status==='COMPLETE');
  select('edition-capture',completed.length?completed.map(item=>({value:item.id,label:item.name+' · '+count(item.rows)+' rows'})):
    [{value:'',label:'Complete a capture first'}],ui.capture?.id);
  update('editions-list',state.editions,()=>state.editions.length?table(['Edition','State','Rows','Keys','Updated','Actions'],
    [...state.editions].reverse().map(item=>[el('div',{},el('strong',{},item.name),el('small',{class:'mono muted'},short(item.sha256??item.id))),
      badge(item.status),count(item.rowCount),arr(item.keyFields).join(', ')||'Review required',stamp(item.updatedAt),
      btn(item.status==='READY'?'Open edition':'Review fields','edition-open',item.id)])):
    empty('Create an edition from a complete capture.'));
  const ready=state.editions.filter(item=>item.status==='READY');
  for(const id of ['compare-left','compare-right','merchant-edition'])
    select(id,ready.length?ready.map(item=>({value:item.id,label:item.name+' · '+count(item.rowCount)+' rows'})):
      [{value:'',label:'Build a reviewed edition first'}]);
  renderCompareFields();
}
function readReviewForm(){
  const allFields=[...$('edition-fields').querySelectorAll('tr[data-source]')].map(row=>{
    const get=name=>row.querySelector('.field-'+name);
    return {source:row.dataset.source,name:get('name').value.trim(),label:get('label').value.trim(),role:get('role').value,
      unit:get('unit').value.trim(),scale:get('scale').value.trim(),notes:get('notes').value,
      nullToken:get('null-enabled').checked?get('null').value:null,included:get('include').checked,key:get('key').checked};
  });
  return {id:ui.edition.id,expectedRevision:ui.editionExpectedRevision,
    fields:allFields.filter(field=>field.included).map(({included,key,...field})=>field),
    keyFields:allFields.filter(field=>field.included&&field.key).map(field=>field.name),
    notes:$('edition-review-notes').value,filters:split($('edition-filters').value),ranges:split($('edition-ranges').value),
    sorts:split($('edition-sorts').value),defaultLimit:Number($('edition-default-limit').value),
    maxLimit:Number($('edition-max-limit').value),allFields};
}
function fieldReviewTable(fields,keyFields,ready){
  const headers=['Source / Include','Published field','Label','Role','Unit','Scale','Row key','Interpretation notes','Null representation'];
  const rows=fields.map(field=>{
    const input=(suffix,value,more={})=>el('input',{class:'field-'+suffix,value,disabled:ready,
      'aria-label':field.source+' '+suffix,...more});
    const include=input('include',undefined,{type:'checkbox',checked:field.included!==false});
    const roles=el('select',{class:'field-role','aria-label':field.source+' role',disabled:ready},
      ['identifier','dimension','date','measure'].map(value=>el('option',{value},value)));
    roles.value=field.role;
    const nullEnabled=input('null-enabled',undefined,{type:'checkbox',checked:field.nullToken!==null&&field.nullToken!==undefined});
    const nullInput=input('null',field.nullToken??'',{disabled:ready||!nullEnabled.checked,placeholder:'Exact null token'});
    return el('tr',{dataset:{source:field.source}},
      el('td',{},el('label',{class:'check'},include,el('span',{class:'mono'},field.source))),
      el('td',{},input('name',field.name,{required:true})),el('td',{},input('label',field.label,{required:true})),
      el('td',{},roles),el('td',{},input('unit',field.unit??'',{required:field.role==='measure'})),
      el('td',{},input('scale',field.scale??'1',{required:true,inputmode:'decimal'})),
      el('td',{},el('label',{class:'check'},input('key',undefined,{type:'checkbox',checked:field.key??keyFields.includes(field.name)}),'Key')),
      el('td',{},el('textarea',{class:'field-notes',rows:2,disabled:ready,required:field.role==='measure',
        'aria-label':field.source+' interpretation notes'},field.notes??'')),
      el('td',{},el('label',{class:'check'},nullEnabled,'Use a token'),nullInput));
  });
  return el('table',{},el('thead',{},el('tr',{},headers.map(header=>el('th',{scope:'col'},header)))),el('tbody',{},rows));
}
async function openEdition(id,offset=0,{discardDraft=false}={}){
  if(ui.editionDirty&&ui.edition)ui.editionDrafts.set(ui.edition.id,readReviewForm());
  if(discardDraft)ui.editionDrafts.delete(id);
  const request=++ui.detailRequests.edition;
  const detail=await action('editions.get',{id});
  const rows=await action('editions.rows',{id,offset,limit:50});
  if(request!==ui.detailRequests.edition)return;
  const retained=ui.editionDrafts.get(id),review=detail.status==='DRAFT'&&retained?retained:null,ready=detail.status==='READY';
  ui.edition=detail;ui.editionOffset=offset;ui.editionDirty=!!review;ui.editionExpectedRevision=review?.expectedRevision??detail.revision;
  $('edition-detail-panel').hidden=false;$('edition-detail-heading').textContent=detail.name;
  $('edition-detail-meta').textContent='Revision '+detail.revision+' · '+count(detail.rowCount)+' rows · capture '+short(detail.captureId)+
    (review?' · unsaved review retained':'');
  $('edition-status').textContent=detail.status;$('edition-status').dataset.state=detail.status;
  $('edition-fields').replaceChildren(fieldReviewTable(review?.allFields??detail.fields,review?.keyFields??detail.keyFields,ready));
  const formData=review??detail;
  $('edition-review-notes').value=formData.notes??'';
  for(const suffix of ['filters','ranges','sorts'])$('edition-'+suffix).value=arr(formData[suffix]??detail.dataset?.[suffix]).join(', ');
  $('edition-default-limit').value=formData.defaultLimit??detail.dataset?.defaultLimit??50;
  $('edition-max-limit').value=formData.maxLimit??detail.dataset?.maxLimit??1000;
  for(const input of $('edition-review-form').querySelectorAll('.inset input,.inset textarea'))input.disabled=ready;
  $('edition-files').hidden=!arr(detail.files).length;
  $('edition-files').replaceChildren(files('edition',id,detail.files));
  showRows('edition',rows,next=>openEdition(id,next));renderAvailability();
}
function renderCompareFields(){
  const left=state.editions.find(item=>item.id===$('compare-left').value);
  const right=state.editions.find(item=>item.id===$('compare-right').value);
  const common=left&&right?left.fields.filter(field=>right.fields.some(other=>other.name===field.name)):[];
  const identity=[left?.id,right?.id,left?.sha256,right?.sha256];
  update('comparison-key-fields',identity,()=>common.length?common.map(field=>el('label',{class:'check'},
    el('input',{type:'checkbox',value:field.name,checked:arr(left.keyFields).includes(field.name),name:'comparison-key'}),
    el('span',{},field.label||field.name,el('small',{class:'mono'},field.name)))):el('p',{class:'muted small'},'Choose two ready editions with shared fields.'));
  const measures=common.filter(field=>field.role==='measure'&&right.fields.find(other=>other.name===field.name)?.role==='measure');
  update('comparison-measure-fields',identity,()=>measures.length?measures.map(field=>{
    const other=right.fields.find(item=>item.name===field.name);
    return el('label',{class:'check'},el('input',{type:'checkbox',value:field.name,checked:true,name:'comparison-measure'}),
      el('span',{},field.label||field.name,el('small',{},field.unit+' × '+field.scale+
        (field.unit===other.unit&&field.scale===other.scale?'':' / '+other.unit+' × '+other.scale))));
  }):el('p',{class:'muted small'},'Shared fields reviewed as measures will appear here.'));
}
function creationRetry(item,kind){
  return item.status!=='READY'&&item.creation?.action&&item.creation?.payload?
    btn(item.status==='BUILDING'?'Resume creation':'Retry creation',kind+'-retry',item.id):null;
}
function renderComparisons(){
  update('comparisons-list',state.comparisons,()=>state.comparisons.length?table(['Comparison','State','Rows added','Rows removed','Rows changed','Created','Actions'],
    [...state.comparisons].reverse().map(item=>[
      el('div',{},el('strong',{},item.name),item.error?el('p',{class:'muted small'},item.error.message):null),
      badge(item.status),item.summary?count(item.summary.added):'—',item.summary?count(item.summary.removed):'—',
      item.summary?count(item.summary.changed):'—',stamp(item.createdAt),
      el('div',{class:'downloads'},btn('Inspect changes','comparison-open',item.id,item.status!=='READY'),creationRetry(item,'comparison'))])):
    empty('Create a comparison to inspect changes between reviewed editions.'));
}
function observationTable(total){
  const values=[];
  for(const [side,observations] of [['Left',total.leftObservations],['Right',total.rightObservations]]){
    for(const group of arr(observations?.groups))values.push([
      side,Object.entries(group.key??{}).map(([key,value])=>key+' = '+text(value)).join(' · ')||'All selected rows',
      group.first?.date??'—',group.first?.value??'—',group.last?.date??'—',group.last?.value??'—',group.change??'—']);
  }
  return values.length?el('div',{class:'table-wrap'},table(
    ['Edition','Series','First date','First value','Last date','Last value','Exact change'],values,
    ['','','mono','mono numeric','mono','mono numeric','mono numeric'])):
    el('p',{class:'muted small'},'No dated numeric observations exist for this measure in the selected editions.');
}
function measureComparison(value){
  const totals=Object.entries(value??{});
  if(!totals.length)return empty('No measures were selected for this comparison.');
  return el('div',{class:'measure-comparisons'},totals.map(([field,total])=>{
    const heading=total.left?.label||total.right?.label||field;
    const context=el('details',{class:'measure-context'},el('summary',{},'Field interpretation and null markers'),
      ['left','right'].map(side=>el('div',{},el('h5',{},side==='left'?'Left edition':'Right edition'),
        readout([['Unit',total[side]?.unit],['Scale',total[side]?.scale],
          ['Null marker',total[side]?.nullToken===null?'JSON null':total[side]?.nullToken??'JSON null']]),
        el('p',{},total[side]?.notes??''))));
    return el('section',{class:'measure-card'},
      el('div',{class:'measure-heading'},el('div',{},el('h4',{},heading),el('p',{class:'mono muted small'},field)),
        badge(total.compatible?'MATCHING UNITS':'UNIT REVIEW')),
      el('p',{class:'small muted'},total.compatible?
        'Unit '+total.unit+' · scale '+total.scale+' · original decimal precision':
        'Left unit '+text(total.left?.unit)+' × '+text(total.left?.scale)+' · right unit '+text(total.right?.unit)+' × '+text(total.right?.scale)),
      el('h5',{},'Dated observations'),observationTable(total),
      el('details',{class:'measure-arithmetic'},el('summary',{},'Arithmetic across selected rows'),
        el('p',{class:'small muted'},'These sums use every numeric observation in each selected row set. For a stock series, use the dated observations above to inspect its change.'),
        el('div',{class:'table-wrap'},table(['Edition','Exact row sum','Numeric values','Null markers','Other values'],[
          ['Left',total.leftSum,count(total.leftNumericRows),count(total.leftMissingRows??0),count(total.leftNonNumericRows)],
          ['Right',total.rightSum,count(total.rightNumericRows),count(total.rightMissingRows??0),count(total.rightNonNumericRows)]
        ],['','mono numeric','numeric','numeric','numeric'])),
        readout([['Right minus left',total.delta],['Comparable row pairs',total.participatingRows],
          ['Pairs with null markers',total.missingPairRows??0],['Pairs with other values',total.nonNumericPairRows??0]])),
      context);
  }));
}
function comparisonRows(rows,totals){
  if(!arr(rows).length)return empty('No rows match this comparison view.');
  return el('div',{class:'comparison-records'},rows.map(row=>{
    const fields=[...new Set([...Object.keys(row.left??{}),...Object.keys(row.right??{})])];
    const changed=new Set(arr(row.changes).map(change=>change.field));
    const identity=Object.entries(row.key??{}).map(([key,value])=>key+' = '+text(value)).join(' · ');
    return el('details',{class:'comparison-record'},el('summary',{},
      badge(row.status),el('span',{class:'mono'},identity||'Row '+count(row.ordinal+1)),
      el('span',{class:'muted small'},count(changed.size)+' fields changed')),
      el('div',{class:'table-wrap'},table(['Field','Left value','Right value','Exact delta','Unit / scale'],fields.map(field=>[
        el('span',{class:changed.has(field)?'changed-field mono':'mono'},field),
        row.left&&Object.hasOwn(row.left,field)?valueNode(row.left[field]):'—',
        row.right&&Object.hasOwn(row.right,field)?valueNode(row.right[field]):'—',
        row.deltas?.[field]??'—',totals?.[field]?.compatible?totals[field].unit+' × '+totals[field].scale:'—'
      ]),['','mono','mono','mono numeric','mono'])));
  }));
}
async function openComparison(id,offset=0){
  const retained=state.comparisons.find(item=>item.id===id);
  if(retained&&retained.status!=='READY'){
    $('comparison-detail-panel').hidden=true;
    notice(retained.error?.message||'This comparison is still being created. Its saved action can resume from the comparison list.');
    return;
  }
  const request=++ui.detailRequests.comparison;
  const detail=await action('comparisons.get',{id,offset,limit:50,changesOnly:$('changes-only').checked});
  if(request!==ui.detailRequests.comparison)return;
  ui.comparison=detail;ui.comparisonOffset=offset;
  $('comparison-detail-panel').hidden=false;$('comparison-detail-heading').textContent=detail.name;
  $('comparison-detail-meta').textContent='Keys: '+detail.keyFields.join(', ')+' · '+stamp(detail.createdAt);
  const summary=detail.summary;
  $('comparison-metrics').replaceChildren(...metric([['Left rows',summary.leftRows],['Right rows',summary.rightRows],['Added',summary.added],
    ['Removed',summary.removed],['Changed',summary.changed],['Unchanged',summary.unchanged]]));
  $('comparison-measures').replaceChildren(measureComparison(summary.measureTotals));
  $('comparison-rows').replaceChildren(comparisonRows(detail.rows,summary.measureTotals));
  paginate('comparison-pagination',detail,next=>openComparison(id,next));
  $('comparison-files').replaceChildren(files('comparison',id,detail.files));
}
function exportCard(item,merchant=false){
  const ready=item.status==='READY';
  return el('article',{class:'export-item'},el('div',{class:'export-heading'},
    el('div',{},el('strong',{},item.kind[0].toUpperCase()+item.kind.slice(1)+' export'),' ',badge(item.status),
      el('p',{class:'muted'},stamp(item.createdAt)+' · source '+short(item.sourceId)),
      ready?el('p',{class:'mono muted'},'SHA256 '+item.sha256):null,
      item.error?el('p',{class:'muted small'},item.error.message):null),
    el('div',{class:'downloads'},merchant?btn('Prepare publisher','publisher-prepare',item.id,!ready):null,creationRetry(item,'export'))),
    ready?files('export',item.id,item.files):null);
}
function renderExports(){
  update('exports-list',state.exports,()=>state.exports.length?[...state.exports].reverse().map(item=>exportCard(item)):
    empty('Capture, edition, comparison, and merchant exports appear here.'));
  update('merchant-exports',state.exports.filter(item=>item.kind==='merchant'),()=>
    state.exports.filter(item=>item.kind==='merchant').reverse().map(item=>exportCard(item,true)));
}
function queryResult(id,result){
  const target=$(id);target.hidden=false;
  const response=result.response??result,body=response.body??response;
  const rows=Array.isArray(body.data)?body.data:Array.isArray(body.rows)?body.rows:null;
  target.replaceChildren(rows?el('div',{class:'table-wrap'},genericTable(rows)):originalDetails('Native query result',result));
  if(rows)target.append(originalDetails('Page metadata and continuation',result));
}
async function makeExport(kind,id){
  const result=await action('exports.create',{kind,id},true);
  location.hash='compare';await route();
  const box=$('exports-list');box.scrollIntoView({block:'nearest',behavior:'smooth'});return result;
}
bind('source-form','input',()=>{ui.sourceDirty=true;renderAvailability();});
bind('new-source','click',()=>openSource(null));
bind('source-endpoint','change',()=>{
  const entry=state.catalog.endpoints.find(item=>item.endpoint===$('source-endpoint').value);
  if(entry&&!$('source-name').value)$('source-name').value=entry.tableName||entry.datasetName;
});
bind('source-form','submit',event=>task('Saving source',async()=>{
  const input=sourceInput();
  if(ui.sourceId){input.id=ui.sourceId;input.expectedRevision=ui.sourceRevision;}
  const result=await action('sources.save',input);
  ui.sourceDrafts.delete(ui.sourceId??'new');ui.sourceDirty=false;openSource(result.id,true);
},event.submitter));
bind('probe-source','click',event=>task('Inspecting live metadata',()=>action('sources.probe',{id:ui.sourceId,revision:ui.sourceRevision}),event.target));
bind('refresh-catalog','click',event=>task('Refreshing Treasury catalogue',()=>action('catalog.refresh',{}),event.target));
bind('capture-form','submit',event=>task('Queueing source capture',async()=>{
  const source=state.sources.find(item=>item.id===$('capture-source').value);
  if(!source)throw new Error('Select a saved source query.');
  const payload={sourceId:source.id,sourceRevision:source.revision,sourceSha256:source.sha256};
  if($('capture-name').value.trim())payload.name=$('capture-name').value.trim();
  const result=await action('captures.start',payload,true);location.hash='capture/'+result.id;
},event.submitter));
bind('capture-create-edition','click',()=>{
  $('edition-capture').value=ui.capture.id;
  if(!$('edition-name').value)$('edition-name').value=ui.capture.name+' · reviewed';
  location.hash='editions';$('edition-name').focus();
});
bind('capture-export','click',event=>task('Exporting complete capture',()=>makeExport('capture',ui.capture.id),event.target));
bind('edition-create-form','submit',event=>task('Creating review edition',async()=>{
  const capture=state.captures.find(item=>item.id===$('edition-capture').value);
  if(!capture)throw new Error('Select a complete capture.');
  const result=await action('editions.create',{captureId:capture.id,captureSha256:capture.sha256,name:$('edition-name').value.trim()},true);
  location.hash='editions/'+result.id;
},event.submitter));
bind('edition-review-form','input',event=>{
  ui.editionDirty=true;
  const row=event.target.closest('tr[data-source]');
  if(row){
    const role=row.querySelector('.field-role').value,included=row.querySelector('.field-include').checked;
    row.querySelector('.field-unit').required=included&&role==='measure';
    row.querySelector('.field-notes').required=included&&role==='measure';
    row.querySelector('.field-name').required=included;row.querySelector('.field-label').required=included;
    row.querySelector('.field-scale').required=included;
    row.querySelector('.field-null').disabled=!row.querySelector('.field-null-enabled').checked;
  }
  renderAvailability();
});
bind('edition-review-form','submit',event=>task('Saving field review',async()=>{
  const {allFields,...payload}=readReviewForm();
  if(!payload.fields.length)throw new Error('Select at least one source field.');
  const result=await action('editions.review',payload);
  ui.editionDirty=false;ui.editionDrafts.delete(result.id);await openEdition(result.id,ui.editionOffset,{discardDraft:true});
},event.submitter));
bind('build-edition','click',event=>task('Building reviewed edition',async()=>{
  const result=await action('editions.build',{id:ui.edition.id,expectedRevision:ui.editionExpectedRevision},true);
  ui.editionDirty=false;ui.editionDrafts.delete(result.id);await openEdition(result.id,0,{discardDraft:true});
},event.target));
bind('edition-export','click',event=>task('Exporting complete edition',()=>makeExport('edition',ui.edition.id),event.target));
bind('edition-query-form','submit',event=>task('Running native dataset query',async()=>{
  const result=await action('editions.query',{id:ui.edition.id,query:$('edition-query').value});
  queryResult('edition-query-result',result);
},event.submitter));
for(const id of ['compare-left','compare-right'])bind(id,'change',renderCompareFields);
bind('comparison-form','submit',event=>task('Comparing reviewed editions',async()=>{
  const keyFields=[...$('comparison-key-fields').querySelectorAll('input:checked')].map(item=>item.value);
  const measureFields=[...$('comparison-measure-fields').querySelectorAll('input:checked')].map(item=>item.value);
  if(!keyFields.length)throw new Error('Select the shared fields that identify one row.');
  const result=await action('comparisons.create',{leftEditionId:$('compare-left').value,rightEditionId:$('compare-right').value,
    keyFields,measureFields,name:$('comparison-name').value.trim()},true);
  location.hash='compare/'+result.id;
},event.submitter));
bind('changes-only','change',()=>ui.comparison&&openComparison(ui.comparison.id));
bind('comparison-export','click',event=>task('Exporting complete comparison',()=>makeExport('comparison',ui.comparison.id),event.target));


function initPublisherControls(){
  if($('pub-draft'))return;
  $('publisher-controls').innerHTML=[
    '<div class="form-grid compact-form">',
    '<label class="span-2">Retained candidate<select id="pub-draft"></select></label>',
    '<div class="form-actions span-2"><button id="pub-review" type="button" class="secondary">Review candidate</button><button id="pub-publish" type="button">Publish candidate</button></div>',
    '<p id="pub-guard" class="small muted span-2"></p></div>',
    '<div id="pub-draft-files" class="downloads section-gap"></div>',
    '<form id="pub-preview-form" class="inline-form subpanel">',
    '<label>Preview selection<select id="pub-preview-target"></select></label>',
    '<label>First-page query<input id="pub-query" value="limit=50" spellcheck="false"></label>',
    '<button type="submit" class="secondary">Preview rows</button></form>',
    '<div id="pub-preview-result" hidden></div>',
    '<div class="inline-form subpanel"><label>Retained published snapshot<select id="pub-snapshot"></select></label>',
    '<button id="pub-activate" type="button" class="secondary">Activate snapshot</button>',
    '<button id="pub-collect" type="button" class="quiet">Collect expired versions</button></div>'
  ].join('');
  $('release-controls').innerHTML=[
    '<form id="release-stage-form" class="form-grid compact-form">',
    '<label>Candidate<select id="release-draft" required></select></label>',
    '<label>Release ID<input id="release-id" required spellcheck="false" placeholder="treasury-debt-20261011"></label>',
    '<label>Release label<input id="release-label" required placeholder="Treasury debt dataset"></label>',
    '<label>Local runtime port<input id="release-port" type="number" min="0" max="65535" value="0" required><span class="help">Zero selects an available port.</span></label>',
    '<label class="span-2">Configured facilitator URL · optional<input id="release-facilitator" type="url" placeholder="https://your-facilitator.example"></label>',
    '<label class="check span-2"><input id="release-local-facilitator" type="checkbox">Allow the configured facilitator on loopback</label>',
    '<div class="form-actions span-2"><button type="submit" class="secondary">Stage release</button></div></form>',
    '<div id="release-catalog" class="table-wrap section-gap"></div>',
    '<div class="inline-form subpanel"><label>Selected release<select id="release-selection"></select></label>',
    '<button id="release-inspect" type="button" class="quiet">Inspect release</button>',
    '<button id="release-activate" type="button" class="secondary">Activate release</button></div>',
    '<div id="release-current" class="section-gap"></div>',
    '<div class="button-row section-gap"><button id="release-start" type="button">Start release</button>',
    '<button id="release-stop" type="button" class="secondary">Stop release</button>',
    '<button id="release-rollback" type="button" class="quiet">Roll back release</button></div>',
    '<div id="release-inspection" class="section-gap" hidden></div>'
  ].join('');
  $('buyer-controls').innerHTML=[
    '<form id="buyer-review-form" class="inline-form compact-form">',
    '<label>Published snapshot<select id="buyer-snapshot" required></select></label>',
    '<label>First-page query<input id="buyer-query" value="limit=50" spellcheck="false"></label>',
    '<button type="submit" class="secondary">Review customer request</button></form>',
    '<div id="buyer-offer" class="section-gap" hidden></div>',
    '<form id="buyer-prepare-form" class="inline-form compact-form section-gap" hidden>',
    '<label>Customer intent<input id="buyer-intent" required spellcheck="false" placeholder="treasury-october-research"></label>',
    '<button type="submit">Prepare customer</button></form>',
    '<h4 class="minor-heading">Prepared customer requests</h4><div id="buyer-catalog" class="table-wrap"></div>',
    '<form id="buyer-session-form" class="form-grid compact-form subpanel">',
    '<label>Prepared customer<select id="buyer-selection" required></select></label>',
    '<label>Buyer workspace<select id="buyer-workspace" required></select></label>',
    '<label>Maximum pages<input id="buyer-max-pages" type="number" min="1" step="1" value="10" required></label>',
    '<label>Total spending limit · atomic units<input id="buyer-max-total" required inputmode="numeric" pattern="[0-9]+" placeholder="Exact atomic limit"></label>',
    '<label>Maximum rows · optional<input id="buyer-max-rows" type="number" min="1" step="1"></label>',
    '<label>Maximum bytes per page · optional<input id="buyer-max-page-bytes" type="number" min="1" step="1"></label>',
    '<p id="buyer-workspace-help" class="muted small span-2"></p>',
    '<div class="form-actions span-2"><button type="submit" class="secondary">Prepare acquisition session</button></div></form>',
    '<h4 class="minor-heading">Acquisition sessions</h4><div id="buyer-sessions"></div>',
    '<h4 class="minor-heading">Complete acquisition deliveries</h4><div id="buyer-deliveries"></div>'
  ].join('');
  const guard=()=>{
    const versions=state.publisher?.target?.versions;
    if(!versions)throw new Error('Prepare a dataset and read its current publisher status.');
    return {expectedSnapshot:versions.current,expectedRevision:versions.revision};
  };
  bind('pub-draft','change',renderPublisher);
  bind('pub-review','click',event=>task('Reviewing publication candidate',()=>
    action('publisher.reviewDraft',{draftId:$('pub-draft').value,...guard()}),event.target));
  bind('pub-publish','click',event=>task('Publishing reviewed candidate',()=>{
    const candidate=state.publisher.drafts.candidates.find(item=>item.id===$('pub-draft').value);
    if(!candidate)throw new Error('Choose a retained candidate.');
    return action('publisher.publish',{draftId:candidate.id,expectedSnapshot:candidate.expectedSnapshot,expectedRevision:candidate.expectedRevision});
  },event.target));
  bind('pub-preview-form','submit',event=>task('Previewing native dataset rows',async()=>{
    queryResult('pub-preview-result',await action('publisher.preview',{target:$('pub-preview-target').value,query:$('pub-query').value}));
  },event.submitter));
  bind('pub-activate','click',event=>task('Activating retained snapshot',()=>
    action('publisher.activateSnapshot',{snapshot:$('pub-snapshot').value,...guard()}),event.target));
  bind('pub-collect','click',event=>task('Collecting expired dataset versions',()=>action('publisher.collect',{}),event.target));
  bind('release-stage-form','submit',event=>task('Staging merchant release',async()=>{
    const runtime={port:Number($('release-port').value)};
    if($('release-facilitator').value.trim()){
      runtime.facilitator=$('release-facilitator').value.trim();
      if($('release-local-facilitator').checked)runtime.allowLocalFacilitator=true;
    }
    const result=await action('publisher.release.stage',{draftId:$('release-draft').value,id:$('release-id').value.trim(),
      label:$('release-label').value.trim(),runtime});
    $('release-selection').value=$('release-id').value.trim();showReleaseInspection(result);return result;
  },event.submitter));
  bind('release-inspect','click',event=>task('Inspecting retained release',async()=>{
    showReleaseInspection(await action('publisher.release.inspect',{id:$('release-selection').value}));
  },event.target));
  bind('release-activate','click',event=>task('Activating merchant release',()=>
    action('publisher.release.activate',{id:$('release-selection').value,expectedGeneration:state.publisher.releases.state.generation}),event.target));
  bind('release-start','click',event=>task('Starting merchant release',()=>
    action('publisher.release.start',{expectedGeneration:state.publisher.releases.state.generation}),event.target));
  bind('release-stop','click',event=>task('Draining merchant release',()=>action('publisher.release.stop',{}),event.target));
  bind('release-rollback','click',event=>task('Rolling back merchant release',()=>
    action('publisher.release.rollback',{expectedGeneration:state.publisher.releases.state.generation}),event.target));
  bind('buyer-review-form','input',()=>{ui.buyerReview=null;$('buyer-offer').hidden=true;$('buyer-prepare-form').hidden=true;});
  bind('buyer-review-form','submit',event=>task('Reviewing customer request',async()=>{
    ui.buyerReview=await action('publisher.buyer.review',{snapshot:$('buyer-snapshot').value,query:$('buyer-query').value});
    showBuyerOffer();
  },event.submitter));
  bind('buyer-prepare-form','submit',event=>task('Preparing original customer request',async()=>{
    const chosen=$('buyer-offer').querySelector('input[name=buyer-accept]:checked');
    if(!ui.buyerReview||!chosen)throw new Error('Review the actual offer and choose its payment option.');
    const result=await action('publisher.buyer.prepare',{review:ui.buyerReview,intentId:$('buyer-intent').value.trim(),
      acceptIndex:Number(chosen.value),offerSha256:ui.buyerReview.offerSha256});
    const buyer=result.buyer;select('buyer-selection',state.publisher.drafts.buyers.map(item=>({value:item.id,label:item.intentId})),buyer.id);
    $('buyer-selection').value=buyer.id;return result;
  },event.submitter));
  bind('buyer-session-form','submit',event=>task('Preparing acquisition session',async()=>{
    const payload={buyerId:$('buyer-selection').value,workspaceId:$('buyer-workspace').value,
      maxPages:Number($('buyer-max-pages').value),maxTotalAtomic:$('buyer-max-total').value};
    if($('buyer-max-rows').value)payload.maxRows=Number($('buyer-max-rows').value);
    if($('buyer-max-page-bytes').value)payload.maxPageBytes=Number($('buyer-max-page-bytes').value);
    const result=await action('publisher.buyer.session',payload);showBuyerResult(result);return result;
  },event.submitter));
}
function safeLink(url,label){
  try{const parsed=new URL(url);if(!['http:','https:'].includes(parsed.protocol))throw new Error();
    return el('a',{href:parsed.href,target:'_blank',rel:'noopener noreferrer'},label??parsed.href);
  }catch{return text(url);}
}
function renderPublisher(){
  const publisher=state.publisher;
  $('release-panel').hidden=!publisher;$('buyer-panel').hidden=!publisher;
  if(!publisher){$('publisher-refresh').disabled=true;return;}
  $('publisher-refresh').disabled=false;initPublisherControls();
  const target=publisher.target,versions=target?.versions,live=!!target?.connected;
  update('publisher-summary',[target,publisher.running],()=>readout([
    ['Dataset',target?.dataset?.name??'Prepared dataset'],['Rows',count(target?.dataset?.rowCount)],
    ['Current snapshot',versions?.current??'—'],['Current revision',versions?.revision??'—'],
    ['Publisher',publisher.running?publisher.running.action:live?'Connected to running seller':'Ready · seller stopped']]));
  const drafts=arr(publisher.drafts?.candidates),published=arr(versions?.versions);
  const draftOptions=drafts.length?drafts.map(item=>({value:item.id,label:item.name+' · '+count(item.dataset?.rowCount)+' rows'})):
    [{value:'',label:'Prepare a merchant export first'}];
  select('pub-draft',draftOptions,publisher.drafts?.selectedDraftId);select('release-draft',draftOptions,publisher.drafts?.selectedDraftId);
  const candidate=drafts.find(item=>item.id===$('pub-draft').value);
  $('pub-guard').textContent=candidate?'Candidate reviewed against snapshot '+short(candidate.expectedSnapshot)+' at revision '+candidate.expectedRevision+
    (live?'.':' · Start a merchant release to review or publish a refresh.'):'';
  $('pub-review').disabled=!candidate||!live;$('pub-publish').disabled=!candidate||!live;
  update('pub-draft-files',candidate?.id,()=>candidate?[
    fileLink('publisher',candidate.id,'draft-csv.csv'),fileLink('publisher',candidate.id,'draft-review.json')]:[]);
  const snapshots=published.map(item=>({value:item.snapshot,label:(item.snapshot===versions.current?'Current · ':'Retained · ')+short(item.snapshot)+
    (item.rowCount!==undefined?' · '+count(item.rowCount)+' rows':'')}));
  select('pub-preview-target',[...drafts.map(item=>({value:'draft:'+item.id,label:'Candidate · '+item.name})),...snapshots],
    candidate?'draft:'+candidate.id:versions?.current);
  select('pub-snapshot',snapshots,versions?.current);select('buyer-snapshot',snapshots,versions?.current);
  $('pub-activate').disabled=!live||!snapshots.length;$('pub-collect').disabled=!live;
  const releases=publisher.releases,releaseState=releases.state,runtime=releases.runtime;
  $('release-running').textContent=runtime.state.replaceAll('_',' ');$('release-running').dataset.state=runtime.state;
  update('release-catalog',releases.releases,()=>releases.releases.length?table(['Release','Label','Created','Digest'],
    releases.releases.map(item=>[item.id,item.label,stamp(item.createdAt),el('span',{class:'mono',title:item.digest},short(item.digest))])):
    empty('Stage a candidate to create its merchant release.'));
  select('release-selection',releases.releases.length?releases.releases.map(item=>({value:item.id,
    label:item.id+(item.id===releaseState.active?' · active':'')})):[{value:'',label:'Stage a release first'}],releaseState.active);
  $('release-inspect').disabled=!$('release-selection').value;$('release-activate').disabled=!$('release-selection').value;
  $('release-start').disabled=!releaseState.active||publisher.ownsRelease;$('release-stop').disabled=!publisher.ownsRelease;
  $('release-rollback').disabled=!releaseState.previous;
  update('release-current',[releaseState,runtime],()=>[
    readout([['Active release',releaseState.active??'—'],['Previous release',releaseState.previous??'—'],
      ['Generation',releaseState.generation],['Runtime',runtime.state],['Listener',runtime.observed?.listener??'—']]),
    runtime.message?el('p',{class:'fine-print'},runtime.message):null,
    runtime.observed?.listener?el('div',{class:'downloads section-gap'},
      ...[['_seller/docs','Seller documentation'],['_seller/offers','Live offers'],['_seller/openapi.json','OpenAPI description']].map(([path,label])=>
        safeLink(runtime.observed.listener.replace(/\/$/,'')+'/'+path,label))):null].filter(Boolean));
  update('buyer-deliveries',state.exports.filter(item=>item.kind==='acquisition'),()=>state.exports.filter(item=>item.kind==='acquisition').reverse().map(item=>exportCard(item)));
  const buyers=arr(publisher.drafts?.buyers);
  update('buyer-catalog',buyers,()=>buyers.length?table(['Customer intent','Snapshot','Created','Request'],
    buyers.map(item=>[item.intentId,el('span',{class:'mono',title:item.snapshot},short(item.snapshot)),stamp(item.createdAt),
      fileLink('publisher',item.id,'buyer-config.json')])):empty('Review a customer request to prepare its buyer configuration.'));
  select('buyer-selection',buyers.length?buyers.map(item=>({value:item.id,label:item.intentId})):[{value:'',label:'Prepare a customer request first'}]);
  select('buyer-workspace',state.buyerWorkspaces.length?state.buyerWorkspaces.map(item=>({value:item.id,label:item.label})):
    [{value:'',label:'No buyer workspace configured'}]);
  $('buyer-workspace-help').textContent=state.buyerWorkspaces.length?
    'The selected buyer workspace supplies its existing account, signer, payment policy, and spend ledger.':
    'Add an existing buyer workspace when starting this operator to enable acquisition.';
  $('buyer-session-form').querySelector('button').disabled=!buyers.length||!state.buyerWorkspaces.length;
  $('buyer-review-form').querySelector('button').disabled=!live||!snapshots.length;
  update('buyer-sessions',publisher.sessions,()=>publisher.sessions.length?publisher.sessions.map(item=>
    el('article',{class:'export-item'},el('div',{class:'export-heading'},el('div',{},
      el('strong',{},buyers.find(buyer=>buyer.id===item.id)?.intentId??short(item.id)),
      el('p',{class:'muted'},'Snapshot '+short(item.binding?.snapshot)+' · '+count(item.binding?.maxPages)+' page limit · '+
        text(item.binding?.maxTotalAtomic)+' atomic total limit'))),
      el('div',{class:'button-row'},btn('Acquire pages','buyer-run',item.id,false,''),btn('Recover session','buyer-recover',item.id),
        btn('Account recorded pages','buyer-account',item.id),btn('Export acquisition','buyer-export',item.id)),
      originalDetails('Acquisition progress and retained attempts',item.error??item.report))):empty('Prepare an acquisition session from a saved customer request.'));
}
function showReleaseInspection(result){
  const node=$('release-inspection');node.hidden=false;
  node.replaceChildren(readout([['Release',result.id],['Digest',result.digest],['Origin',result.publicOrigin??result.origin],
    ['Dataset snapshot',result.dataset?.baselineSnapshot??result.dataset?.snapshot??'—']]),
    originalDetails('Release configuration, routes, and dataset binding',result));
}
function showBuyerOffer(){
  const review=ui.buyerReview;if(!review)return;
  $('buyer-offer').hidden=false;$('buyer-prepare-form').hidden=false;
  const choices=arr(review.accepts).map((item,index)=>[
    el('label',{class:'check'},el('input',{type:'radio',name:'buyer-accept',value:index,checked:index===0}),'Option '+(index+1)),
    item.scheme,item.network,item.asset,el('span',{class:'mono'},text(item.amount??item.maxAmountRequired)),
    el('span',{class:'mono'},item.payTo),text(item.maxTimeoutSeconds)]);
  $('buyer-offer').replaceChildren(readout([['Request',review.url],['Snapshot',review.snapshot],['Seller mode',review.mode],
    ['Offer digest',review.offerSha256]]),
    el('h4',{class:'minor-heading'},'Actual payment options'),
    el('div',{class:'table-wrap'},table(['Choice','Scheme','Network','Asset','Atomic amount','Recipient','Timeout seconds'],choices)),
    originalDetails('Reviewed source page and offer',review.preview??review));
}
function showBuyerResult(result){
  $('buyer-result').hidden=false;
  $('buyer-result').replaceChildren(originalDetails('Acquisition result',result));
  if(result.id&&result.manifest)$('buyer-result').prepend(files('publisher',result.id,['session-manifest.json']));
}
bind('merchant-form','submit',event=>task('Building merchant package',async()=>{
  const payment={scheme:$('payment-scheme').value.trim(),network:$('payment-network').value.trim(),
    asset:$('payment-asset').value.trim(),amount:$('payment-amount').value,payTo:$('payment-address').value.trim(),
    maxTimeoutSeconds:Number($('payment-timeout').value)};
  return action('merchant.configure',{editionId:$('merchant-edition').value,origin:$('merchant-origin').value.trim(),
    path:$('merchant-path').value.trim(),payment},true);
},event.submitter));
bind('publisher-refresh','click',event=>task('Refreshing original publisher',()=>action('publisher.status',{}),event.target));
document.addEventListener('click',event=>{
  const button=event.target.closest('button[data-action]');
  if(!button||button.disabled)return;
  const kind=button.dataset.action,id=button.dataset.id;
  if(!kind)return;
  const go=async()=>{
    if(kind==='source-open'){openSource(id);return;}
    if(kind==='capture-open'){if(location.hash==='#capture/'+id)await openCapture(id);else location.hash='capture/'+id;return;}
    if(kind==='edition-open'){if(location.hash==='#editions/'+id)await openEdition(id);else location.hash='editions/'+id;return;}
    if(kind==='comparison-open'){if(location.hash==='#compare/'+id)await openComparison(id);else location.hash='compare/'+id;return;}
    if(kind.startsWith('capture-')){
      const verb=kind.slice(8);
      await task(verb==='cancel'?'Cancelling capture':verb==='pause'?'Pausing capture':'Resuming original capture',async()=>{
        await action('captures.'+verb,{id});if(ui.capture?.id===id)await openCapture(id,ui.captureOffset);
      },button);return;
    }
    if(kind==='comparison-retry'||kind==='export-retry'){
      const item=(kind==='comparison-retry'?state.comparisons:state.exports).find(row=>row.id===id);
      if(!item?.creation)throw new Error('Refresh this saved action before resuming it.');
      if(item.status==='READY')return;
      await task(kind==='comparison-retry'?'Resuming comparison':'Resuming export',
        ()=>action(item.creation.action,item.creation.payload),button);return;
    }
    if(kind==='publisher-prepare'){await task('Preparing dataset publisher',()=>action('publisher.prepare',{exportId:id}),button);return;}
    if(['buyer-run','buyer-recover','buyer-account','buyer-export'].includes(kind)){
      const verb=kind.slice(6);
      await task({run:'Acquiring dataset pages',recover:'Recovering original session',account:'Accounting recorded pages',export:'Exporting completed acquisition'}[verb],
        async()=>showBuyerResult(await action('publisher.buyer.'+verb,{id})),button);
    }
  };
  go().catch(fail);
});
async function route(){
  const [selected,id]=location.hash.slice(1).split('/'),view=['capture','editions','compare','publish'].includes(selected)?selected:'capture';
  for(const node of document.querySelectorAll('.view'))node.hidden=node.id!=='view-'+view;
  for(const link of document.querySelectorAll('nav [data-view]')){
    if(link.dataset.view===view)link.setAttribute('aria-current','page');else link.removeAttribute('aria-current');
  }
  if(!state||!id)return;
  if(view==='capture')await openCapture(id);
  if(view==='editions')await openEdition(id);
  if(view==='compare')await openComparison(id);
}
window.addEventListener('hashchange',()=>route().catch(fail));
bind('refresh-state','click',async()=>{
  await refresh();
  if(ui.capture&&!$('view-capture').hidden)await openCapture(ui.capture.id,ui.captureOffset);
  if(ui.edition&&!$('view-editions').hidden)await openEdition(ui.edition.id,ui.editionOffset);
  if(ui.comparison&&!$('view-compare').hidden)await openComparison(ui.comparison.id,ui.comparisonOffset);
});
async function poll(){
  clearTimeout(pollTimer);
  if(document.visibilityState==='visible'){
    try{await refresh();}catch{$('connection').textContent='Connection interrupted';$('connection').dataset.state='FAILED';}
  }
  pollTimer=setTimeout(poll,state?.worker?.captureId?5000:15000);
}
document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible')poll();});
async function start(){
  await refresh();if(state.sources.length)openSource(state.sources[0].id);
  await route();pollTimer=setTimeout(poll,5000);
}
start().catch(error=>{fail(error);$('connection').textContent='Unable to open';pollTimer=setTimeout(poll,5000);});
