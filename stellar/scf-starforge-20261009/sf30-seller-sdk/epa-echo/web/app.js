// MIT. Original EPA ECHO operator console and complete workspace receiving.
const $=id=>document.getElementById(id);
const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const pretty=value=>JSON.stringify(value,null,2);
const short=value=>String(value??'').slice(0,12);
const badge=value=>'<span class="badge">'+esc(String(value??'unknown').replaceAll('_',' '))+'</span>';
const when=value=>value?esc(value):'Not supplied';
const bytes=value=>Number.isFinite(value)?new Intl.NumberFormat().format(value)+' bytes':'Not supplied';
let storageKey=null;
function saved(key,fallback=null){try{return storageKey?JSON.parse(sessionStorage.getItem(storageKey+key))??fallback:fallback;}catch{return fallback;}}
function remember(key,value){try{if(!storageKey)return false;if(value===null)sessionStorage.removeItem(storageKey+key);else sessionStorage.setItem(storageKey+key,JSON.stringify(value));return true;}catch{return false;}}
const tokenKey='epa-echo:session:'+location.origin;
let token=location.hash.slice(1);
if(token){try{sessionStorage.setItem(tokenKey,token);}catch{}history.replaceState(null,'',location.pathname+location.search);}
else{try{token=sessionStorage.getItem(tokenKey);}catch{}}
const S={schema:null,view:null,section:'portfolio',table:'',offset:0,rows:null,editions:[],editionOffset:0,comparison:null,
  queryResult:null,querySelection:null,buyerResult:null,modal:null,source:null,pending:null,refreshing:false,rowRequest:0,
  recordFilter:'',portfolioFilter:'',facilityId:'',reportSection:'',searchId:'',searchPage:null,searchOffset:0,searchRequest:0,
  received:null,receivedFilter:'',operationBusy:false};
const views=new Set(['portfolio','captures','facilities','editions','reviews','publishing','receiving']);
const importActions=new Set(['capture.import','workspace.receive']);
function button(label,op,data={},primary=false){
  return '<button type="button" data-op="'+esc(op)+'"'+Object.entries(data).map(([key,value])=>' data-'+key.replace(/[A-Z]/g,c=>'-'+c.toLowerCase())+'="'+esc(value)+'"').join('')+(primary?' class="primary"':'')+'>'+esc(label)+'</button>';
}
const actions=html=>'<div class="actions">'+html+'</div>';
const empty=(title,body,buttons='')=>'<section class="empty"><h2>'+esc(title)+'</h2><p>'+esc(body)+'</p>'+actions(buttons)+'</section>';
const heading=(title,description,buttons='')=>'<div class="heading"><div><h1>'+esc(title)+'</h1><p class="muted">'+esc(description)+'</p></div>'+actions(buttons)+'</div>';
const details=(label,value,open=false)=>'<details'+(open?' open':'')+'><summary>'+esc(label)+'</summary><pre>'+esc(pretty(value))+'</pre></details>';
function records(headers,rows){
  if(!rows.length)return '<p class="muted">No saved records in this view.</p>';
  return '<div class="table-wrap"><table class="records-table" role="table"><thead role="rowgroup"><tr role="row">'+headers.map(h=>'<th scope="col" role="columnheader">'+esc(h)+'</th>').join('')+'</tr></thead><tbody role="rowgroup">'+rows.map(row=>'<tr role="row">'+row.map((cell,i)=>'<td role="cell"'+(i===headers.length-1?' class="controls"':'')+'><span class="mobile-label">'+esc(headers[i])+'</span><div>'+cell+'</div></td>').join('')+'</tr>').join('')+'</tbody></table></div>';
}
function metrics(items){return '<div class="metrics">'+items.map(([number,label])=>'<div class="metric"><strong>'+esc(number)+'</strong><span>'+esc(label)+'</span></div>').join('')+'</div>';}
function notice(message,controls=''){$('notice').innerHTML=message?'<div>'+esc(message)+'</div>'+actions(controls):'';}
function notifyPending(){if(S.pending)notice('An original action is awaiting its result: '+S.pending.action+'.',button('Continue saved action','retry-action')+button('Inspect operation','inspect-pending'));}
function errorText(error){return (error.message||String(error))+(error.retryAt?' Retry after '+error.retryAt+'.':'')+(error.operationId?' Operation '+error.operationId+'.':'');}
async function request(path,options={}){
  const url=new URL(path,location.href);
  if(url.origin!==location.origin||!url.pathname.startsWith('/api/')||url.username||url.password||url.hash)
    throw new Error('Choose a download or operation from this original workspace.');
  const response=await fetch(url,{...options,headers:{Authorization:'Bearer '+token,...options.headers}});
  if(!response.ok){let body;try{body=await response.json();}catch{}
    throw Object.assign(new Error(body?.message??'The workspace returned HTTP '+response.status+'.'),body??{},{status:response.status});}
  return response;
}
const read=async path=>(await request(path)).json();
const params=(path,values)=>path+'?'+new URLSearchParams(Object.entries(values).filter(([,v])=>v!==undefined&&v!==null&&v!==''));
const selected=()=>S.view?.selectedEdition;
const portfolioName=value=>typeof value==='string'?S.view?.portfolios.find(p=>p.id===value)?.label??value:value?.label??value?.id??'Facility portfolio';
const editionLabel=e=>portfolioName(e.portfolio)+' · '+(e.label||'Edition')+' · '+short(e.id)+' · '+(e.complete?'complete':'partial');
const allEditions=()=>S.editions;
function tableDefinitions(){
  const tables=S.schema?.tables??[];
  return Array.isArray(tables)?tables.map(t=>typeof t==='string'?{id:t,label:t}:t):Object.entries(tables).map(([id,t])=>({id,...(typeof t==='string'?{label:t}:t)}));
}
function tableColumns(table,rows){
  const definition=tableDefinitions().find(t=>t.id===table);
  let columns=rows?.columns??definition?.columns??S.schema?.columns??[];
  if(!Array.isArray(columns))columns=Array.isArray(columns[table])?columns[table]:Object.entries(columns).map(([name,c])=>({name,...(typeof c==='string'?{type:c}:c)}));
  return columns.map(c=>typeof c==='string'?{name:c,label:c}:({...c,name:c.name??c.id??c.key,label:c.label??c.title??c.name??c.id??c.key})).filter(c=>c.name);
}
function acceptView(view){
  if(!view||view.workspaceId!==S.schema.workspaceId||!Number.isSafeInteger(view.revision))throw new Error('The returned workspace identity differs from this selected session.');
  const previous=S.view;
  S.editionOffset=Math.max(view.editions.length,S.editionOffset+Math.max(0,view.editionCount-(previous?.editionCount??view.editionCount)));
  S.view=view;
  const older=S.editions.filter(e=>!view.editions.some(r=>r.id===e.id));S.editions=[...view.editions,...older];
  if(view.selectedEdition&&!S.editions.some(e=>e.id===view.selectedEdition.id))S.editions.push(view.selectedEdition);
  $('workspace-id').textContent='Workspace '+short(view.workspaceId)+' · revision '+view.revision;
  const e=selected();
  $('current-edition').innerHTML=e?'<strong>'+esc(portfolioName(e.portfolio))+'</strong><p>'+badge(e.complete?'Complete':'Partial')+'</p><code>'+esc(short(e.id))+'</code><p>'+esc(e.pages?.length??0)+' original responses</p>':'Choose a source edition.';
}
async function refresh({quiet=false}={}){
  if(S.refreshing)return;S.refreshing=true;$('refresh').disabled=true;
  try{const old=selected()?.id;acceptView(await read('/api/view'));render();
    if(S.section==='facilities'&&(old!==selected()?.id||!S.rows))await loadRows();
    if(!quiet)notifyPending();
  }catch(error){notice(errorText(error));}
  finally{S.refreshing=false;$('refresh').disabled=false;}
}
async function download(path,name){
  const response=await request(path),blob=await response.blob(),url=URL.createObjectURL(blob),a=document.createElement('a');
  a.href=url;a.download=name||'epa-echo-source';document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),30000);
}
function field(name,label,{type='text',value='',options=[],help='',full=false,required=false,readonly=false,placeholder=''}={}){
  if(type==='hidden')return '<input type="hidden" name="'+esc(name)+'" value="'+esc(value)+'">';
  let control;
  if(type==='textarea')control='<textarea name="'+esc(name)+'" id="f-'+esc(name)+'"'+(required?' required':'')+(readonly?' readonly':'')+' placeholder="'+esc(placeholder)+'">'+esc(value)+'</textarea>';
  else if(type==='select')control='<select name="'+esc(name)+'" id="f-'+esc(name)+'"'+(required?' required':'')+'>'+options.map(option=>{
    const [id,title]=Array.isArray(option)?option:[option,option];return '<option value="'+esc(id)+'"'+(String(id)===String(value)?' selected':'')+'>'+esc(title)+'</option>';
  }).join('')+'</select>';
  else if(type==='checkbox')control='<label class="check"><input type="checkbox" name="'+esc(name)+'" id="f-'+esc(name)+'"'+(value?' checked':'')+'>'+esc(label)+'</label>';
  else control='<input id="f-'+esc(name)+'" name="'+esc(name)+'" type="'+esc(type)+'"'+(type!=='file'?' value="'+esc(value)+'"':' accept=".json,application/json"')+
    (required?' required':'')+(readonly?' readonly':'')+(type==='number'?' step="any"':'')+' placeholder="'+esc(placeholder)+'">';
  return '<div class="field'+(full?' full':'')+'">'+(type!=='checkbox'?'<label for="f-'+esc(name)+'">'+esc(label)+'</label>':'')+control+(help?'<p class="help">'+esc(help)+'</p>':'')+'</div>';
}
function formValues(form){const out={};for(const e of form.elements){if(!e.name||e.type==='file'||e.type==='submit')continue;out[e.name]=e.type==='checkbox'?e.checked:e.value;}return out;}
function applyValues(form,values){for(const e of form.elements){if(!e.name||e.type==='file'||values[e.name]===undefined)continue;if(e.type==='checkbox')e.checked=values[e.name]===true;else e.value=values[e.name];}}
function dialogDraft(modal,values){
  let pending=modal.pending??null;
  if(importActions.has(modal.kind)&&pending?.payload&&modal.sourcePackage){const {bundle,...payload}=pending.payload;pending={...pending,payload};}
  return {workspaceId:S.schema.workspaceId,kind:modal.kind,context:modal.context,expectedRevision:modal.expectedRevision,values,pending,sourcePackage:modal.sourcePackage??null};
}
function restoreImportBody(modal,bundle,selection){
  if(importActions.has(modal.pending?.action)&&modal.pending.payload&&!Object.hasOwn(modal.pending.payload,'bundle')&&modal.sourcePackage?.sha256===selection.sha256)
    modal.pending={...modal.pending,payload:{...modal.pending.payload,bundle}};
  modal.sourcePackage=selection;
}
function saveDialog(){
  const modal=S.modal;if(!modal||!$('operation-form'))return false;
  const retained=remember('dialog',dialogDraft(modal,formValues($('operation-form'))));
  if(!retained)$('dialog-error').textContent='Browser storage could not retain the pending form. Free browser storage and submit again; the entered form remains open.';
  return retained;
}
function clearConflict(){$('dialog-conflict').hidden=true;$('latest-view').hidden=true;$('latest-view').textContent='';$('adopt-latest').disabled=true;if(S.modal){S.modal.reviewedView=null;S.modal.conflict=false;}}
function currentGeneration(release){return release?.selection?.generation??release?.publisher?.releases?.state?.generation??null;}

function paymentFields(){
  const schemas=S.schema.paymentSchema?.properties??S.schema.paymentSchema??{};
  const defaults=S.schema.paymentDefaults??{};
  const names=S.schema.paymentFields??['scheme','network','asset','amount','payTo','maxTimeoutSeconds'];
  return names.map(name=>{
    const spec=schemas[name]??{},value=defaults[name]??spec.default??({scheme:'exact',network:'stellar:testnet',maxTimeoutSeconds:300}[name]??'');
    const label={scheme:'Payment scheme',network:'Payment network',asset:'Asset contract',amount:'Atomic amount per request',payTo:'Merchant account',maxTimeoutSeconds:'Payment timeout in seconds'}[name]??name;
    return field(name,label,{type:spec.enum?'select':name==='maxTimeoutSeconds'?'number':'text',options:spec.enum??[],value,required:true,
      help:spec.description??(name==='amount'?'Use the reviewed amount in this asset’s atomic units.':name==='asset'?'Use the asset contract selected by the original merchant configuration.':'')});
  }).join('');
}
function searchFields(){
  const fields=S.schema.searchFields??[];
  return (Array.isArray(fields)?fields:Object.entries(fields).map(([name,field])=>({name,...field}))).map(field=>({...field,name:field.name??field.id}));
}
function queryColumns(dataset){
  const source=dataset?.description?.columns??dataset?.description?.fields??dataset?.columns??[];
  return (Array.isArray(source)?source:Object.entries(source).map(([name,field])=>({name,...field})))
    .map(c=>typeof c==='string'?{name:c}:({...c,name:c.name??c.id})).filter(c=>c.name);
}
function originalDateIso(dataset,name){
  const columns=queryColumns(dataset);
  return columns.some(c=>c.name===name+'Iso')?name+'Iso':null;
}
function queryBuilder(dataset,query='limit=50'){
  const columns=queryColumns(dataset),q=new URLSearchParams(query),picked=q.get('fields')?.split(',')??[];
  return '<fieldset class="query-builder"><legend>Build from this original dataset</legend><div class="fields">'+
    field('queryLimit','Rows per page',{type:'number',value:q.get('limit')??50,help:'The original dataset enforces its own page limit.'})+
    field('querySort','Sort column',{type:'select',options:[['','Provider default'],...columns.map(c=>[c.name,c.name])],value:(q.get('sort')??'').replace(/^-/,'')})+
    field('queryDescending','Descending order',{type:'checkbox',value:(q.get('sort')??'').startsWith('-')})+
    '<div class="field full"><label>Returned fields</label><div class="checks">'+columns.map(c=>'<label class="check"><input type="checkbox" name="queryField" value="'+esc(c.name)+'"'+(picked.includes(c.name)?' checked':'')+'>'+esc(c.name)+'</label>').join('')+'</div><p class="help">Leave all unchecked to use the dataset’s original default selection.</p></div>'+
    field('queryFilterField','Filter field',{type:'select',options:[['','No new filter'],...columns.map(c=>[c.name,c.name+(originalDateIso(dataset,c.name)?' · original date (equality)':'')])],value:''})+
    field('queryFilterOperator','Comparison',{type:'select',options:[['where','Equals'],['gte','Greater than or equal'],['lte','Less than or equal'],['gt','Greater than'],['lt','Less than']],value:'where'})+
    field('queryFilterValue','Original filter value',{value:'',full:true,help:'Keep source identifiers literal. Choose the separate ISO date column for chronological ranges; original display dates support equality in this builder.'})+
    '</div>'+actions(button('Apply fields and filter to query','build-query'))+
    '<p class="help">The query text remains reviewable below. Applying a builder change removes an old page cursor and preserves other explicitly entered filters.</p></fieldset>';
}
function modalFields(kind,context){
  const e=selected(),portfolios=S.view.portfolios.filter(p=>p.active),portfolioOptions=portfolios.map(p=>[p.id,p.label]),
    editionOptions=allEditions().map(e=>[e.id,editionLabel(e)]),tableOptions=tableDefinitions().map(t=>[t.id,t.label??t.id]);
  const editionField=(name='editionId',value=e?.id)=>field(name,'Source edition',{type:'select',options:editionOptions,value,required:true,full:true});
  if(kind==='portfolio.save'){
    const item=S.view.portfolios.find(p=>p.id===context.id);
    return {title:item?'Edit facility portfolio':'Create facility portfolio',submit:'Save portfolio',html:
      field('portfolioId','',{type:'hidden',value:item?.id??''})+
      field('label','Portfolio name',{value:item?.label??context.label??'',required:true})+
      field('customer','Customer or project',{value:item?.customer??''})+
      field('owner','Responsible staff member or team',{value:item?.owner??''})+
      field('active','Portfolio is active',{type:'checkbox',value:item?.active??true})+
      field('facilityIds','FRS facility identifiers, in order',{type:'textarea',value:item?.facilityIds?.join('\n')??context.facilityIds??'',required:true,full:true,
        help:'Enter one original FRS identifier per line. Search results and retained EPA reports provide the facility identities.'})+
      field('note','Portfolio instructions',{type:'textarea',value:item?.note??'',full:true}),
      help:'Prior captures retain the facility selection that was actually used. Saving changes creates portfolio history.'};
  }
  if(kind==='facility.search'){
    const previous=S.view.searches.find(s=>s.id===context.id);
    const fields=searchFields();
    return {title:'Search original EPA facilities',submit:'Search and retain source',html:
      field('label','Search label',{value:previous?.label??'',full:true})+
      fields.map(spec=>field('search__'+spec.name,spec.label??spec.name,{type:spec.enum?'select':spec.type==='boolean'?'checkbox':spec.type==='integer'||spec.type==='number'?'number':'text',
        options:spec.enum?['',...spec.enum]:[],value:spec.default??'',help:spec.description??'',placeholder:spec.placeholder??'',required:spec.required===true})).join('')+
      field('query','Original provider query JSON',{type:'textarea',value:pretty(previous?.query??S.schema.searchExample??{}),required:true,full:true,
        help:'Use the exact EPA query fields from this installed source contract. Entered structured fields above override the same explicitly named JSON field.'})+
      '<div class="field full">'+details('Current facility-search contract',S.schema.searchContract??S.schema.source??{})+'</div>'};
  }
  if(kind==='capture.start')return {title:'Capture original facility reports',submit:'Start report capture',html:
    field('portfolioId','Facility portfolio',{type:'select',options:portfolioOptions,value:context.id??portfolioOptions[0]?.[0],required:true,full:true})+
    field('label','Edition label',{value:context.label??'',full:true}),
    help:'The original capture fetches the selected FRS facilities and retains each report, provider receipt and facility coverage independently.'};
  if(kind==='capture.import'||kind==='workspace.receive'){
    const receiving=kind==='workspace.receive';
    return {title:receiving?'Receive complete original workspace':'Import original EPA source',submit:receiving?'Receive workspace package':'Import source package',html:
      (receiving?'':field('portfolioId','Facility portfolio',{type:'select',options:portfolioOptions,value:context.id??portfolioOptions[0]?.[0],required:true,full:true})+
        field('label','Edition label',{value:'',full:true}))+
      field('file',receiving?'Original complete workspace package':'Original EPA ECHO source package',{type:'file',full:true,
        help:'Select the complete original JSON package. If the browser reloads after a lost reply, reselect the same file to continue the original saved operation.'}),
      help:receiving?'Retain and reopen the original portfolios, reports, editions, staff reviews and source files from this portable workspace.':'Original source response bytes, program reporting dates and selected facility identities travel with the package.'};
  }
  if(kind==='edition.compare')return {title:'Compare original report editions',submit:'Compare editions',html:
    editionField('leftId',context.leftId??allEditions()[1]?.id??e?.id)+editionField('rightId',context.rightId??e?.id)+
    field('table','Source table',{type:'select',options:tableOptions,value:S.table,required:true,full:true}),
    help:'The original comparison preserves added, removed and changed source records and the full selected capture scope.'};
  if(kind==='review.save'){
    const note=S.view.reviews.find(r=>r.id===context.id),ep=note?allEditions().find(x=>x.id===note.editionId):e;
    const statuses=S.schema.reviewStatuses??['open','reviewed','follow_up','resolved'];
    return {title:note?'Update staff review':'Add staff review',submit:'Save review',html:
      field('reviewId','',{type:'hidden',value:note?.id??''})+
      field('portfolioId','Portfolio',{type:'select',options:S.view.portfolios.map(p=>[p.id,p.label]),value:note?.portfolioId??ep?.portfolio?.id??ep?.portfolio??portfolioOptions[0]?.[0],required:true,full:true})+
      editionField('editionId',note?.editionId??context.editionId??e?.id)+
      field('facilityId','Original FRS facility identifier',{value:note?.facilityId??context.facilityId??S.facilityId??'',help:'Leave empty for a portfolio-wide review.'})+
      field('status','Review status',{type:'select',options:statuses.map(s=>[s,s.replaceAll('_',' ')]),value:note?.status??'open',required:true})+
      field('owner','Responsible staff member',{value:note?.owner??''})+field('dueDate','Follow-up due date',{type:'date',value:note?.dueDate??''})+
      field('subject','Review subject',{value:note?.subject??context.subject??'',required:true,full:true})+
      field('note','Source finding, decision and follow-up',{type:'textarea',value:note?.note??'',full:true})};
  }
  if(kind==='dataset.prepare')return {title:'Prepare original report dataset',submit:'Prepare dataset',html:
    editionField()+field('table','Source table',{type:'select',options:tableOptions,value:S.table,required:true,full:true})+
    field('name','Dataset name',{value:e?portfolioName(e.portfolio)+' · '+S.table:'',full:true}),
    help:'The original SF30 engine receives the selected table and its complete source lineage.'};
  if(kind==='dataset.query'){
    const dataset=S.view.datasets.find(d=>d.id===context.id)??S.view.datasets[0],query=context.query??'limit=50';
    return {title:'Query original dataset',submit:'Run query',html:
      field('datasetId','Dataset',{type:'select',options:S.view.datasets.map(d=>[d.id,d.name]),value:dataset?.id,required:true,full:true})+
      '<div class="field full" id="query-builder-host">'+queryBuilder(dataset,query)+'</div>'+
      field('query','Original dataset query string',{type:'textarea',value:query,full:true})+
      '<div class="field full">'+details('Original dataset schema',dataset?.description??dataset??{})+'</div>'};
  }
  if(kind==='release.prepare')return {title:'Prepare original dataset release',submit:'Prepare release',html:
    field('datasetId','Dataset',{type:'select',options:S.view.datasets.map(d=>[d.id,d.name]),value:context.id??S.view.datasets[0]?.id,required:true,full:true})+
    field('origin','Public dataset origin',{type:'url',value:'',required:true,full:true,placeholder:'https://data.example.org'})+
    field('path','Dataset route',{value:'/epa-facilities',required:true})+paymentFields(),
    help:'Review the selected original merchant origin, asset and per-request terms. The native publisher retains the resulting release selection.'};
  if(['release.activate','release.start','release.rollback'].includes(kind)){
    const release=S.view.releases.find(r=>r.id===context.id),generation=currentGeneration(release);
    if(!release||generation===null)throw new Error('Inspect this original release to obtain its current generation before changing the selection.');
    return {title:kind.split('.')[1]+' original release',submit:kind.split('.')[1]+' release',html:
      field('releaseId','Release',{value:release.id,readonly:true,required:true,full:true})+
      field('expectedGeneration','Current publisher generation',{type:'number',value:generation,readonly:true,required:true,full:true})+
      '<div class="field full">'+details('Original publisher state',release.publisher??release)+'</div>'};
  }
  if(kind==='buyer.inspect'||kind==='buyer.receive')return {title:kind==='buyer.inspect'?'Inspect original buyer intents':'Receive original customer files',
    submit:kind==='buyer.inspect'?'Inspect intents':'Receive customer files',html:
      field('intentIds','Original SF88 intent IDs, in page order',{type:'textarea',value:context.intentIds?.join('\n')??saved('intentIds',[]).join('\n'),required:true,full:true,
        help:'One existing intent ID per line. The receiver preserves this exact original page order.'})};
  if(kind==='export.create')return {title:'Export original source edition',submit:'Create export',html:
    editionField()+field('table','Source table',{type:'select',options:tableOptions,value:S.table,full:true})+
    field('format','File format',{type:'select',options:[['json','Complete edition JSON'],['csv','Selected table CSV'],['report','Printable staff report'],['source-package','Original portable source package']],value:context.format??'json',required:true,full:true})};
  throw new Error('This original form is unavailable.');
}
function openForm(kind,context={},restoring=null){
  if(!S.view)return;
  if(restoring?.workspaceId&&restoring.workspaceId!==S.schema.workspaceId)throw new Error('This saved form belongs to a different original workspace.');
  const definition=modalFields(kind,context),pending=restoring?.pending??null;
  S.modal={kind,context,expectedRevision:restoring?.expectedRevision??S.view.revision,pending,sourcePackage:restoring?.sourcePackage??null,busy:false,reviewedView:null,conflict:false};
  $('dialog-title').textContent=definition.title;
  $('dialog-body').innerHTML=(definition.help?'<p class="muted">'+esc(definition.help)+'</p>':'')+
    '<form id="operation-form"><div class="fields">'+definition.html+'</div><p class="help" id="form-revision">Opened at workspace revision '+esc(S.modal.expectedRevision)+'.</p>'+
    '<div class="form-actions"><button type="button" data-op="close-form">Keep draft and close</button><button type="submit" class="primary">'+esc(definition.submit)+'</button></div></form>';
  $('dialog-error').textContent='';clearConflict();
  if(restoring?.values)applyValues($('operation-form'),restoring.values);
  $('operation-form').addEventListener('input',saveDialog);
  $('operation-form').addEventListener('change',saveDialog);
  $('operation-form').addEventListener('submit',event=>{event.preventDefault();void submitForm();});
  if(!$('dialog').open)$('dialog').showModal();
  saveDialog();
}

async function payloadOf(modal){
  const values=formValues($('operation-form'));
  if(modal.kind==='portfolio.save'){
    values.facilityIds=values.facilityIds.split(/[\s,;]+/).filter(Boolean);
    if(!values.portfolioId)delete values.portfolioId;
  }
  if(modal.kind==='facility.search'){
    let query;try{query=JSON.parse(values.query);}catch{throw new Error('Use valid original facility-query JSON.');}
    if(!query||typeof query!=='object'||Array.isArray(query))throw new Error('The original search query must be an object.');
    for(const spec of searchFields()){
      const key='search__'+spec.name,value=values[key];delete values[key];
      if(value!==''&&value!==undefined)query[spec.name]=spec.type==='number'||spec.type==='integer'?Number(value):value;
    }
    values.query=query;
  }
  if(importActions.has(modal.kind)){
    const file=$('operation-form').elements.namedItem('file').files[0];
    let bundle,rawSha256=null;
    if(file){
      if(file.size>(S.schema.fileLimits?.serializedImportBytes??256*1024*1024))throw new Error('Choose an original package within this workspace’s declared serialized import limit.');
      const raw=await file.arrayBuffer(),rawHash=await crypto.subtle.digest('SHA-256',raw);
      rawSha256=Array.from(new Uint8Array(rawHash),n=>n.toString(16).padStart(2,'0')).join('');
      bundle=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(raw));
    }else bundle=modal.pending?.payload?.bundle;
    if(!bundle)throw new Error(modal.sourcePackage?'Select '+(modal.sourcePackage.name||'the original package')+' again to continue this saved operation.':'Select the complete original JSON package.');
    const expected=modal.kind==='capture.import'?'stellar-forge.epa-echo-source-package.v1':'stellar-forge.epa-echo-workspace-package.v1';
    if(bundle.schema!==expected)throw new Error('Select the original '+expected+' package.');
    const digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(bundle)));
    const sha256=Array.from(new Uint8Array(digest),n=>n.toString(16).padStart(2,'0')).join('');
    restoreImportBody(modal,bundle,{name:file?.name??modal.sourcePackage?.name??'epa-echo-package.json',
      bytes:file?.size??modal.sourcePackage?.bytes??null,sha256,rawSha256:rawSha256??modal.sourcePackage?.rawSha256??null});
    values.bundle=bundle;
  }
  if(modal.kind==='review.save'){
    for(const field of ['reviewId','facilityId'])if(!values[field])delete values[field];
  }
  if(modal.kind==='release.prepare'){
    values.payment={};for(const name of S.schema.paymentFields??['scheme','network','asset','amount','payTo','maxTimeoutSeconds']){
      values.payment[name]=name==='maxTimeoutSeconds'?Number(values[name]):values[name];delete values[name];
    }
  }
  if(modal.kind==='dataset.query'){
    for(const name of Object.keys(values))if(name.startsWith('query')&&name!=='query')delete values[name];
  }
  if(modal.kind.startsWith('release.')&&Object.hasOwn(values,'expectedGeneration'))values.expectedGeneration=Number(values.expectedGeneration);
  if(modal.kind.startsWith('buyer.')){values.intentIds=values.intentIds.split(/[\s,]+/).filter(Boolean);remember('intentIds',values.intentIds);}
  for(const field of ['label','name'])if(values[field]==='')delete values[field];
  return values;
}
async function postAction(requestValue){return(await request('/api/action',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(requestValue)})).json();}
function sameAction(a,action,payload){return a?.action===action&&JSON.stringify(a.payload)===JSON.stringify(payload);}
async function submitForm(){
  const modal=S.modal;if(!modal||modal.busy)return;
  const form=$('operation-form');if(!form.reportValidity())return;
  modal.busy=true;for(const e of form.querySelectorAll('button'))e.disabled=true;$('dialog-close').disabled=true;$('dialog-error').textContent='';
  try{
    const payload=await payloadOf(modal);
    if(!sameAction(modal.pending,modal.kind,payload))modal.pending={action:modal.kind,payload,expectedRevision:modal.expectedRevision,operationId:crypto.randomUUID()};
    if(!saveDialog())throw new Error('Free browser storage so this original request can be retained before submission.');
    const response=await postAction(modal.pending);
    if(response.view)acceptView(response.view);
    if(!Object.hasOwn(response,'result')){$('dialog-error').textContent='The original operation is still running. Submit this unchanged form to read its retained result.';return;}
    remember('dialog',null);modal.pending=null;$('dialog').close();S.modal=null;clearConflict();
    handleResult(modal.kind,response.result,payload);render();
    if(S.section==='facilities')await loadRows();
  }catch(error){
    $('dialog-error').textContent=errorText(error);
    if(error.status===409){modal.conflict=true;$('dialog-conflict').hidden=false;$('adopt-latest').disabled=true;if(error.view)acceptView(error.view);}
    saveDialog();
  }finally{modal.busy=false;for(const e of form.querySelectorAll('button'))e.disabled=false;$('dialog-close').disabled=false;}
}
async function runAction(action,payload={},existing=null){
  if(S.operationBusy)return;
  if(S.pending&&!existing&&!sameAction(S.pending,action,payload)){notifyPending();return;}
  const pending=existing??(sameAction(S.pending,action,payload)?S.pending:{action,payload,operationId:crypto.randomUUID(),expectedRevision:S.view.revision});
  S.pending=pending;
  if(!remember('pending',pending)){notice('Free browser storage so this original action can be retained before submission.');return;}
  S.operationBusy=true;
  try{
    const response=await postAction(pending);if(response.view)acceptView(response.view);
    if(!Object.hasOwn(response,'result')){notifyPending();render();return;}
    S.pending=null;remember('pending',null);handleResult(action,response.result,pending.payload);render();
    if(S.section==='facilities')await loadRows();
  }catch(error){
    if(error.view)acceptView(error.view);
    const operation=S.view?.operations.find(o=>o.operationId===pending.operationId);
    if(error.status===409&&!operation){S.pending=null;remember('pending',null);notice(errorText(error)+' Review the current saved view before selecting this action again.');}
    else notice(errorText(error),button('Continue saved action','retry-action')+button('Inspect operation','inspect-pending'));
    render();
  }finally{S.operationBusy=false;}
}
function handleResult(action,result,payload={}){
  if(action==='edition.compare'){S.comparison=result;S.section='editions';}
  else if(action==='dataset.query'){S.queryResult=result;S.querySelection={datasetId:payload.datasetId,query:payload.query??''};S.section='publishing';}
  else if(action==='buyer.inspect'){S.buyerResult=result;S.section='receiving';}
  else if(action==='buyer.receive'||action==='workspace.export')S.section='receiving';
  else if(action==='workspace.receive'){S.section='receiving';S.received=null;}
  else if(action==='edition.select'){S.section='facilities';S.offset=0;S.rows=null;S.facilityId='';S.reportSection='';}
  else if(action==='facility.search'){S.searchId=result.id??result.searchId??'';S.searchOffset=0;S.searchPage=null;S.section='portfolio';if(S.searchId)void loadSearch();}
  else if(action.startsWith('capture.')){S.section='captures';S.rows=null;}
  else if(action==='review.save')S.section='reviews';
  else if(action==='dataset.prepare'||action.startsWith('release.'))S.section='publishing';
  else if(action.startsWith('portfolio.'))S.section='portfolio';
  else if(action==='export.create')S.section='receiving';
  remember('section',S.section);
  const labels={'portfolio.save':'Facility portfolio saved.','portfolio.archive':'Portfolio archived.','facility.search':'Original facility search retained.',
    'capture.start':'The original facility capture is saved and collecting reports.','capture.import':'Original source package received.',
    'capture.resume':'The original capture is continuing.','capture.pause':'The capture will pause after retaining its completed source.',
    'edition.select':'Original report edition selected.','edition.compare':'Complete edition comparison saved.','review.save':'Staff review saved.',
    'dataset.prepare':'Original dataset prepared.','dataset.query':'Original dataset query completed.','release.prepare':'Original release prepared.',
    'release.inspect':'Original release inspected.','release.activate':'Original release activated.','release.start':'Original publisher started.',
    'release.stop':'Original publisher stopped.','release.rollback':'Original release selection rolled back.','buyer.inspect':'Original buyer intents inspected.',
    'buyer.receive':'Original customer files received.','export.create':'Original edition export created.','workspace.export':'Complete original workspace package created.',
    'workspace.receive':'Complete original workspace received.'};
  notice(labels[action]??'Original workspace action completed.',result?.downloadUrl?button('Download package','download',{url:result.downloadUrl,name:result.name}):'');
  if(action==='release.inspect')openSourceData('Original publisher inspection',result);
}

function render(){
  if(!S.view)return;
  for(const item of document.querySelectorAll('nav [data-view]'))item.setAttribute('aria-current',item.dataset.view===S.section?'page':'false');
  const sections={portfolio:renderPortfolio,captures:renderCaptures,facilities:renderFacilities,editions:renderEditions,reviews:renderReviews,publishing:renderPublishing,receiving:renderReceiving};
  $('content').innerHTML=sections[S.section]();
}
function pageTable(rows,columns,controls){
  if(!rows.length)return '<p class="muted">No original rows in this selected page.</p>';
  if(!columns.length)columns=Object.keys(rows[0]??{}).map(name=>({name,label:name}));
  return '<div class="table-wrap"><table class="data-table"><thead><tr>'+columns.map(c=>'<th scope="col">'+esc(c.label??c.name)+'</th>').join('')+
    (controls?'<th scope="col">Original record</th>':'')+'</tr></thead><tbody>'+rows.map((row,index)=>'<tr>'+columns.map(c=>'<td>'+
      esc(row[c.name]===null?'null':typeof row[c.name]==='object'?pretty(row[c.name]):row[c.name])+'</td>').join('')+
      (controls?'<td>'+actions(controls(row,index))+'</td>':'')+'</tr>').join('')+'</tbody></table></div>';
}
function renderSearch(){
  if(!S.view.searches.length)return '';
  let body='<section class="panel"><h2>Retained original facility searches</h2>'+
    records(['Search','Original query','Saved','Actions'],S.view.searches.map(item=>[
      '<strong>'+esc(item.label??item.id)+'</strong><code>'+esc(short(item.id))+'</code>',
      details('Selected original query',item.query??item.selection),when(item.createdAt),
      actions(button('Open results','search-open',{id:item.id})+button('Search again','form',{kind:'facility.search',id:item.id})+button('Source metadata','search-detail',{id:item.id}))]));
  if(S.searchId){
    const result=S.searchPage;
    body+='<h3>Selected result page</h3>';
    if(!result)body+='<p>Loading the original result…</p>';
    else{
      const columns=result.columns??S.schema.searchColumns??[];
      body+=pageTable(result.rows,columns.map(c=>typeof c==='string'?{name:c,label:c}:c),(row,index)=>
        button('Read original row','search-row',{index})+(row.facilityId?button('Use this FRS facility','use-facility',{id:row.facilityId}):''))+
        '<div class="pagination"><span>'+esc(result.total?S.searchOffset+1:0)+'–'+esc(Math.min(S.searchOffset+result.rows.length,result.total))+' of '+esc(result.total)+' original matches</span>'+
        actions('<button type="button" data-op="search-previous"'+(!S.searchOffset?' disabled':'')+'>Previous page</button>'+
          '<button type="button" data-op="search-next"'+(S.searchOffset+result.rows.length>=result.total?' disabled':'')+'>Next page</button>')+'</div>'+
        details('Original search provenance',result.source??result.search??result.receipt??{searchId:S.searchId});
    }
  }
  return body+'</section>';
}
function renderPortfolio(){
  const portfolios=S.view.portfolios,active=portfolios.filter(p=>p.active);
  let body=heading('Facility portfolios','Retain selected FRS facilities, customer instructions and responsible staff across original report editions.',
    button('Create portfolio','form',{kind:'portfolio.save'},true)+button('Search EPA facilities','form',{kind:'facility.search'}));
  body+=metrics([[active.length,'Active portfolios'],[new Set(active.flatMap(p=>p.facilityIds)).size,'Selected facilities'],[S.view.editionCount,'Original report editions'],[S.view.reviews.filter(r=>r.status==='follow_up').length,'Follow-up reviews']]);
  if(!portfolios.length)body+=empty('Create the first facility portfolio','Search the original EPA service or enter known FRS identifiers. Each report edition retains the exact ordered facility selection.',button('Create portfolio','form',{kind:'portfolio.save'},true));
  else{
    const selected=portfolios.filter(p=>!S.portfolioFilter||[p.label,p.customer,p.owner,p.note,...p.facilityIds].join(' ').toLowerCase().includes(S.portfolioFilter.toLowerCase()));
    body+='<div class="toolbar">'+field('portfolio-filter','Find a portfolio or FRS facility',{value:S.portfolioFilter,placeholder:'Name, customer, owner or FRS identifier'})+'</div>'+
      records(['Portfolio','Facility selection','Customer and owner','Actions'],selected.map(p=>[
        '<strong>'+esc(p.label)+'</strong><p>'+badge(p.active?'active':'archived')+'</p><code>'+esc(short(p.id))+'</code>',
        esc(p.facilityIds.length)+' original FRS facilities'+details('Ordered original facility identifiers',p.facilityIds),
        '<strong>'+esc(p.customer||'No customer label')+'</strong><p>'+esc(p.owner||'Unassigned')+'</p><p>'+esc(p.note||'')+'</p>',
        actions(button('Edit','form',{kind:'portfolio.save',id:p.id})+(p.active?
          button('Capture reports','form',{kind:'capture.start',id:p.id})+button('Import source','form',{kind:'capture.import',id:p.id})+button('Archive','archive-portfolio',{id:p.id}):
          button('Reopen portfolio','reopen-portfolio',{id:p.id}))+button('Portfolio history','portfolio-detail',{id:p.id}))]));
  }
  return body+renderSearch();
}
function renderCaptures(){
  let body=heading('Original source captures','Inspect each retained facility response and continue the same unfinished capture.',
    button('Capture reports','form',{kind:'capture.start'},true)+button('Import original source','form',{kind:'capture.import'}));
  if(!S.view.portfolios.some(p=>p.active))return body+empty('Create an active portfolio','A report capture keeps the exact original facility selection from its portfolio.',button('Create portfolio','form',{kind:'portfolio.save'},true));
  if(!S.view.captures.length)return body+empty('No source captures yet','Fetch original detailed facility reports or import the complete retained EPA source package.',button('Capture reports','form',{kind:'capture.start'},true));
  for(const c of S.view.captures){
    const tasks=Array.isArray(c.tasks)?c.tasks:Object.values(c.tasks??{}),running=['RUNNING','QUEUED'].includes(c.state);
    body+='<section class="panel"><div class="heading"><div><h2>'+esc(c.label||portfolioName(c.portfolio))+'</h2><p>'+esc(portfolioName(c.portfolio))+' · '+badge(c.state)+'</p><code>'+esc(c.id)+'</code></div>'+
      actions((c.editionId?button('Open edition','select-edition',{id:c.editionId}):'')+(running?button('Pause','capture-pause',{id:c.id}):c.state!=='COMPLETE'?button('Continue capture','capture-resume',{id:c.id}):''))+'</div>'+
      '<p>'+esc(c.pageCount??c.pageReceipts?.length??0)+' original responses · '+bytes(c.byteCount)+'</p>'+
      (c.error?'<p>'+esc(c.error.message??c.error)+'</p>':'')+(c.retryAt?'<p class="help">Original provider retry time: '+esc(c.retryAt)+'</p>':'')+
      '<div class="coverage">'+tasks.map(t=>'<div><strong>'+esc(t.facilityId??t.kind??t.id)+'</strong>'+badge(t.state)+
        '<p>'+esc(t.kind??'Original facility report')+'</p>'+(t.error?'<p>'+esc(t.error.message??t.error)+'</p>':'')+
        (t.retryAt?'<p class="help">Retry after '+esc(t.retryAt)+'</p>':'')+'</div>').join('')+'</div>'+
      details('Exact original capture selection',c.selection)+details('Complete facility coverage',c.coverage)+details('Original response receipts',c.pageReceipts??[])+'</section>';
  }
  return body;
}
function tableCount(e,table){
  const tables=e.summary?.tableCounts??e.summary?.tables;
  return Array.isArray(tables)?tables.find(t=>t.id===table)?.rows??0:tables?.[table]?.rows??tables?.[table]??'—';
}
function editionOverview(e){
  return '<section class="panel"><div class="heading"><div><h2>'+esc(portfolioName(e.portfolio))+'</h2><p>'+esc(e.label??'Original source edition')+' · '+badge(e.complete?'complete capture':'partial capture')+'</p><code>'+esc(e.id)+'</code></div>'+
    actions(button('Add staff review','form',{kind:'review.save',editionId:e.id})+button('Export edition','form',{kind:'export.create'}))+'</div>'+
    metrics([[e.selection?.facilityIds?.length??e.portfolio?.facilityIds?.length??e.facilitySummaries?.length??'—','Selected original facilities'],
      [e.pageCount??e.pages?.length??0,'Original response files'],[e.summary?.totalRows??(e.summary?.tableCounts?Object.values(e.summary.tableCounts).reduce((sum,value)=>sum+(Number.isSafeInteger(value)?value:0),0):'—'),'Projected source rows'],[S.view.reviews.filter(r=>r.editionId===e.id).length,'Staff reviews']])+
    '<p class="help">Program labels, permit identifiers and reporting dates remain the values supplied in each original EPA report. Open the original facility and source records to inspect their scope.</p>'+
    details('Full source coverage',e.coverage)+details('Original source contract and selection',{sourceContract:e.sourceContract,sourceMetadata:e.sourceMetadata,selection:e.selection,summary:e.summary})+'</section>';
}
function sourceButton(row,e){
  const digest=row.sourcePageSha256??row.sourceSha256;
  const page=digest?e.pages.findIndex(p=>p.sha256===digest):-1;
  return page>=0?button('Original source','source',{edition:e.id,page}):'';
}
function sourceList(e){
  return records(['Original response','Source identity','Facility and retrieval','Actions'],e.pages.map((p,index)=>[
    '<strong>'+esc(p.kind)+'</strong><p class="mono">'+esc(p.url??p.originalRequestUrl)+'</p>',
    '<code>'+esc(p.sha256)+'</code><p>'+bytes(p.bytes)+'</p>',
    '<p>'+esc(p.facilityId??'Source contract / search')+'</p><p>'+when(p.sourceObservedAt??p.receipt?.retrievedAt??p.retrievedAt)+'</p>',
    actions(button('Read original response','source',{edition:e.id,page:index})+button('Download original body','raw-download',{edition:e.id,page:index})+
      (p.responseSha256&&p.responseSha256!==p.sha256?button('Original transport response','raw-download',{edition:e.id,page:index,wire:'true'}):''))]));
}
function renderFacilities(){
  const e=selected();
  let body=heading('Facility reports','Review complete source fields, original permit identities and reporting periods from the selected edition.',
    e?button('Prepare dataset','form',{kind:'dataset.prepare'},true):'');
  if(!e)return body+empty('Choose an original report edition','Open a retained source capture to review its facility reports.',button('Open captures','section',{section:'captures'}));
  body+=editionOverview(e);
  const ids=e.selection?.facilityIds??e.portfolio?.facilityIds??e.facilitySummaries?.map(f=>f.facilityId)??[];
  body+='<div class="toolbar">'+field('report-table','Original table',{type:'select',options:tableDefinitions().map(t=>[t.id,(t.label??t.id)+' · '+tableCount(e,t.id)+' rows']),value:S.table})+
    field('facility-filter','FRS facility',{type:'select',options:[['','All selected facilities'],...ids.map(id=>[id,id])],value:S.facilityId})+
    field('section-filter','Original report section',{value:S.reportSection,placeholder:'All sections'})+
    field('record-filter','Find within this displayed page',{value:S.recordFilter,placeholder:'Source field, identifier or value'})+button('Load selected rows','load-rows')+
    (S.facilityId?button('Full facility report','facility-detail',{edition:e.id,id:S.facilityId}):'')+'</div>';
  if(!S.rows||S.rows.editionId!==e.id||S.rows.table!==S.table)body+='<p>Loading original source rows…</p>';
  else{
    const needle=S.recordFilter.toLowerCase(),visible=S.rows.rows.map((row,index)=>({row,index})).filter(({row})=>!needle||pretty(row).toLowerCase().includes(needle));
    const columns=tableColumns(S.table,S.rows);
    body+=pageTable(visible.map(x=>x.row),columns,(row,index)=>button('Full record','row',{index:visible[index].index})+
      (row.facilityId?button('Facility report','facility-detail',{edition:e.id,id:row.facilityId}):'')+sourceButton(row,e));
    body+='<div class="pagination"><span>'+esc(S.rows.total?S.rows.offset+1:0)+'–'+esc(Math.min(S.rows.offset+S.rows.rows.length,S.rows.total))+' of '+esc(S.rows.total)+' original rows'+
      (needle?' · '+visible.length+' match on this page':'')+'</span>'+actions(
      '<button type="button" data-op="previous-rows"'+(!S.offset?' disabled':'')+'>Previous page</button>'+
      '<button type="button" data-op="next-rows"'+(S.offset+S.rows.rows.length>=S.rows.total?' disabled':'')+'>Next page</button>')+'</div>';
    body+=details('Original table and column descriptions',{table:tableDefinitions().find(t=>t.id===S.table),columns});
  }
  body+='<section class="panel"><h2>Original detailed facility records</h2>'+
    records(['Facility','Original summary','Actions'],(e.facilitySummaries??[]).map(f=>[
      '<strong>'+esc(f.facilityName??f.name??f.facilityId)+'</strong><code>'+esc(f.facilityId)+'</code>',details('Retained facility summary',f),
      actions(button('Read full facility','facility-detail',{edition:e.id,id:f.facilityId})+button('Add staff review','form',{kind:'review.save',editionId:e.id,facilityId:f.facilityId}))]))+'</section>';
  return body+'<section class="panel"><h2>Original response files</h2>'+sourceList(e)+'</section>';
}
function renderEditions(){
  let body=heading('Editions and changes','Reopen original dated report editions and retain a complete source comparison.',button('Compare editions','form',{kind:'edition.compare'},true));
  if(!allEditions().length)return body+empty('No saved editions','Original response captures produce retained immutable editions.',button('Open captures','section',{section:'captures'}));
  body+=records(['Original edition','Coverage and selection','Saved','Actions'],allEditions().map(e=>[
    '<strong>'+esc(portfolioName(e.portfolio))+'</strong><p>'+esc(e.label)+'</p><code>'+esc(short(e.id))+'</code>',
    badge(e.complete?'complete':'partial')+'<p>'+esc(e.pageCount??e.pages?.length??0)+' original responses</p>'+details('Selected facility scope',e.selection),
    when(e.createdAt),actions(button(S.view.selectedEditionId===e.id?'Open selected':'Open edition','select-edition',{id:e.id})+button('Compare','form',{kind:'edition.compare',rightId:e.id}))]));
  if(S.editionOffset<S.view.editionCount)body+=actions(button('Load earlier editions','more-editions'));
  const c=S.comparison;
  if(c){
    body+='<section class="panel"><h2>Selected original comparison</h2><p>'+esc(c.table)+' · '+esc(short(c.leftId))+' → '+esc(short(c.rightId))+'</p>'+
      metrics(Object.entries(c.counts??{}).map(([label,count])=>[count,label]))+
      (c.meaning?'<p>'+esc(c.meaning)+'</p>':'')+
      (c.export?.downloadUrl?actions(button('Download complete comparison','download',{url:c.export.downloadUrl,name:c.export.name})):'')+
      details('Original comparison scope',{coverage:c.coverage,selection:c.selection,sourceIntervals:c.sourceIntervals});
    for(const kind of ['added','removed','changed']){
      const rows=c[kind]??[];
      body+='<h3>'+esc(kind)+'</h3>'+rows.slice(0,30).map(row=>details(row.id??row.key??'Original record',row)).join('');
      if(!rows.length)body+='<p class="muted">No '+esc(kind)+' records.</p>';
      if((c.counts?.[kind]??rows.length)>30)body+='<p class="help">The complete comparison file retains all '+esc(kind)+' records.</p>';
    }
    if(c.duplicates?.length)body+=details('Original duplicate identities',c.duplicates);
    body+='</section>';
  }
  const prior=S.view.exports.filter(x=>x.kind==='comparison');
  if(prior.length)body+='<section class="panel"><h2>Saved original comparisons</h2>'+records(['Comparison','Saved','Actions'],prior.map(x=>[
    esc(x.table)+'<p>'+esc(x.name)+'</p>',when(x.createdAt),actions(button('Open comparison','open-export',{id:x.id})+button('Download','download',{url:x.downloadUrl,name:x.name}))]))+'</section>';
  return body;
}
function renderReviews(){
  let body=heading('Staff reviews','Retain the source finding, responsible staff member, due date and original decision history.',button('Add review','form',{kind:'review.save'},true));
  if(!S.view.editionCount)return body+empty('Open a source edition','A staff review retains the original facility and edition that was examined.',button('Open captures','section',{section:'captures'}));
  if(!S.view.reviews.length)return body+empty('Start the portfolio review','Record the source finding and required follow-up against the selected original report.',button('Add review','form',{kind:'review.save'},true));
  for(const r of [...S.view.reviews].sort((a,b)=>(b.updatedAt??'').localeCompare(a.updatedAt??''))){
    body+='<article class="note"><header><div><h2>'+esc(r.subject)+'</h2>'+badge(r.status)+'</div>'+actions(button('Update review','form',{kind:'review.save',id:r.id})+
      button('Open source edition','select-edition',{id:r.editionId}))+'</header><p>'+esc(r.note)+'</p>'+
      '<p><strong>'+esc(r.owner||'Unassigned')+'</strong> · due '+when(r.dueDate)+' · FRS '+esc(r.facilityId||'Portfolio-wide')+'</p>'+
      '<small>'+esc(short(r.editionId))+' · '+when(r.updatedAt)+'</small>'+details('Prior saved decisions',r.history??[])+'</article>';
  }
  return body;
}
function renderQuery(result){
  if(!result)return '';
  const data=result.rows??result.data??[],columns=result.fields??result.columns??(data[0]&&typeof data[0]==='object'?Object.keys(data[0]):[]),
    names=Array.isArray(columns)?columns.map(c=>typeof c==='string'?c:c.name):Object.keys(columns);
  let html='<section class="panel"><h2>Original dataset query result</h2>';
  if(Array.isArray(data)&&data.length&&names.length)html+='<div class="table-wrap"><table class="data-table"><thead><tr>'+names.map(c=>'<th>'+esc(c)+'</th>').join('')+'</tr></thead><tbody>'+
    data.map(row=>'<tr>'+names.map(c=>'<td>'+esc(typeof row[c]==='object'?pretty(row[c]):row[c])+'</td>').join('')+'</tr>').join('')+'</tbody></table></div>';
  html+='<p>'+esc(result.page?.returned??data.length)+' rows returned · '+esc(result.page?.total??data.length)+' matching rows.</p>';
  if(S.querySelection)html+=actions(button('First result page','query-first')+(result.page?.nextCursor?button('Next result page','query-next'):'')+button('Edit query','form',{kind:'dataset.query',id:S.querySelection.datasetId,query:S.querySelection.query}));
  return html+details('Complete query result',result)+'</section>';
}

function renderPublishing(){
  let body=heading('Datasets and publishing','Query the original source dataset and operate its original SF82 publisher.',button('Prepare dataset','form',{kind:'dataset.prepare'},true));
  if(!S.view.editionCount)return body+empty('Open an original source edition','Choose the report table that the original dataset engine should prepare.',button('Open captures','section',{section:'captures'}));
  body+='<h2>Prepared source datasets</h2>'+records(['Dataset','Original snapshot','Source selection','Actions'],S.view.datasets.map(d=>[
    '<strong>'+esc(d.name)+'</strong><p>'+esc(d.rows)+' rows · '+esc(d.columns?.length??queryColumns(d).length)+' columns</p>',
    '<code>'+esc(d.snapshot)+'</code><p>'+esc(d.mode??'Original dataset')+'</p>',
    esc(d.table)+'<p><code>'+esc(short(d.editionId))+'</code></p>',
    actions(button('Query','form',{kind:'dataset.query',id:d.id})+button('Prepare release','form',{kind:'release.prepare',id:d.id})+button('Full dataset description','dataset-detail',{id:d.id}))]));
  body+=renderQuery(S.queryResult);
  if(S.schema.releaseRuntime)body+='<section class="panel"><h2>Original publisher runtime</h2><p>'+esc(String(S.schema.releaseRuntime.mode??'').replaceAll('_',' '))+'</p>'+
    details('Selected native runtime',S.schema.releaseRuntime)+'</section>';
  body+='<h2>Original merchant releases</h2>'+records(['Release','Selection and runtime','Original source','Actions'],S.view.releases.map(r=>{
    const generation=currentGeneration(r),runtime=r.publisher?.releases?.runtime;
    return ['<strong>'+esc(r.id)+'</strong><p>'+esc(r.release?.publicOrigin??r.routes?.[0]?.resource??'')+'</p>',
      '<p>Generation '+esc(generation??'Inspect original publisher')+'</p><p>Active: '+esc(r.selection?.active??'none')+'</p>'+badge(runtime?.state??'Not started')+
        (r.publisherError?'<p>'+esc(r.publisherError.message)+'</p>':''),
      '<code>'+esc(r.snapshot)+'</code><p>'+esc(r.mode??'')+'</p>',
      actions(button('Inspect','release-inspect',{id:r.id})+button('Activate','form',{kind:'release.activate',id:r.id})+
        button('Start','form',{kind:'release.start',id:r.id})+button('Stop','release-stop',{id:r.id})+button('Roll back','form',{kind:'release.rollback',id:r.id}))];
  }));
  return body;
}
function receivedRows(){
  if(!S.received)return '';
  const r=S.received,receiptId=r.receipt?.id??r.id??S.receivedId,files=r.files??[],
    filtered=files.filter(f=>!S.receivedFilter||(f.path??f.name??'').toLowerCase().includes(S.receivedFilter.toLowerCase())),
    offset=S.receivedOffset??0,shown=filtered.slice(offset,offset+100);
  let body='<section class="panel"><div class="heading"><div><h2>Original received workspace</h2><p>Source '+esc(r.sourceWorkspaceId??r.receipt?.sourceWorkspaceId??r.state?.workspaceId)+' · revision '+esc(r.sourceRevision??r.receipt?.sourceRevision??r.state?.revision)+'</p></div>'+
    actions(button('Download original state view','download',{url:params('/api/received-workspace',{receiptId}),name:'received-workspace-'+receiptId+'.json'}))+'</div>'+
    metrics([[files.length,'Retained original files'],[r.editions?.length??r.state?.editions?.length??r.receipt?.editionCount??'—','Original editions'],
      [r.state?.portfolios?.length??r.receipt?.portfolioCount??'—','Original portfolios'],[r.state?.reviews?.length??r.receipt?.reviewCount??'—','Original staff reviews']])+
    details('Complete original working state',r.state)+details('Original source editions',r.editions??[])+details('Received package identity',r.receipt??{sourceWorkspaceId:r.sourceWorkspaceId,sourceRevision:r.sourceRevision})+
    '<div class="toolbar">'+field('received-filter','Find an original file path',{value:S.receivedFilter,placeholder:'Original relative path'})+'</div>'+
    records(['Original relative path','Original bytes and hash','Actions'],shown.map(f=>{
      const path=f.path??f.name;
      return ['<code>'+esc(path)+'</code>',bytes(f.bytes)+'<p><code>'+esc(f.sha256)+'</code></p>',
        actions(button('Download original file','download',{url:params('/api/received-workspace-file',{receiptId,path}),name:String(path).split('/').at(-1)})+
          button('Read original file','received-file',{id:receiptId,path}))];
    }));
  body+='<div class="pagination"><span>'+esc(filtered.length?offset+1:0)+'–'+esc(Math.min(offset+shown.length,filtered.length))+' of '+esc(filtered.length)+' matching original files</span>'+actions(
    '<button type="button" data-op="received-previous"'+(!offset?' disabled':'')+'>Previous files</button>'+
    '<button type="button" data-op="received-next"'+(offset+shown.length>=filtered.length?' disabled':'')+'>Next files</button>')+'</div>';
  return body+'</section>';
}
function renderReceiving(){
  let body=heading('Customer and workspace receiving','Receive original customer outcomes and reopen complete source work with its original files and history.',
    button('Export complete workspace','workspace-export',{},true)+button('Receive workspace package','form',{kind:'workspace.receive'}));
  if(S.schema.inboxConfigured)body+='<section class="panel"><h2>Original buyer inbox</h2>'+
    actions(button('Inspect buyer intents','form',{kind:'buyer.inspect'})+button('Receive customer files','form',{kind:'buyer.receive'},true))+'</section>';
  else body+='<section class="panel"><h2>Original buyer inbox</h2><p>Use the original private SF88 inbox in this application’s launch settings to inspect purchased page intents and receive their completed outcomes.</p></section>';
  if(S.buyerResult){
    const items=S.buyerResult.items??[];
    body+='<section class="panel"><h2>Selected original buyer intents</h2>'+
      records(['Intent','State and attempt','Original outcome','Actions'],items.map(i=>[
        '<code>'+esc(i.intentId)+'</code>',badge(i.status)+'<p>Attempt '+esc(i.attempt??'not supplied')+'</p>',
        details('Retained original outcome',i.outcome),actions(button('Receive selected group','receive-selected'))]))+'</section>';
  }
  body+='<h2>Original customer dataset files</h2>';
  for(const r of S.view.receipts){
    body+='<section class="panel"><h3>'+esc(r.dataset?.name??r.id)+'</h3><p>'+esc(r.mode)+' · '+when(r.createdAt)+'</p>'+
      '<p>'+esc(r.dataset?.rows??'—')+' rows · '+esc(r.intentIds?.length??0)+' ordered original page intents</p>'+
      records(['Customer file','Original file identity','Actions'],(r.downloads??[]).map(f=>[
        '<strong>'+esc(f.name)+'</strong>',bytes(f.bytes)+'<p><code>'+esc(f.sha256)+'</code></p>',
        actions(button('Download '+f.name,'download',{url:f.downloadUrl,name:f.name}))]))+
      details('Original receiving selection',{id:r.id,intentIds:r.intentIds,dataset:r.dataset,manifestSha256:r.manifestSha256})+'</section>';
  }
  if(!S.view.receipts.length)body+='<p class="muted">No customer datasets have been received yet.</p>';
  body+='<section class="panel"><h2>Complete received workspaces</h2>'+
    records(['Source workspace','Original content','Received','Actions'],S.view.receivedWorkspaces.map(r=>[
      '<code>'+esc(r.sourceWorkspaceId)+'</code><p>Original revision '+esc(r.sourceRevision)+'</p>',
      esc(r.fileCount)+' original files<p>'+esc(r.portfolioCount)+' portfolios · '+esc(r.editionCount)+' editions · '+esc(r.reviewCount)+' reviews</p>',
      when(r.receivedAt),actions(button('Open original workspace','received-open',{id:r.id})+button('Package metadata','received-detail',{id:r.id}))]))+'</section>'+receivedRows();
  body+='<section class="panel"><div class="heading"><div><h2>Original exports</h2><p>Full workspace packages, source packages, edition JSON, table CSV and printable reports.</p></div>'+actions(button('Export edition','form',{kind:'export.create'}))+'</div>'+
    records(['Export','Original selection','File identity','Actions'],S.view.exports.filter(e=>e.kind!=='comparison').slice().reverse().map(e=>[
      '<strong>'+esc(e.format??e.kind)+'</strong><p>'+esc(e.name)+'</p>',esc(e.table??'Complete workspace')+'<p><code>'+esc(short(e.editionId??e.workspaceId))+'</code></p>',
      bytes(e.bytes)+'<p><code>'+esc(e.sha256)+'</code></p>',
      actions(button('Download original export','download',{url:e.downloadUrl,name:e.name})+button('Export metadata','export-detail',{id:e.id}))]))+'</section>';
  return body;
}

async function loadRows(){
  const e=selected();if(!e||!S.table)return;
  const sequence=++S.rowRequest,table=S.table,offset=S.offset,facilityId=S.facilityId,section=S.reportSection;
  try{
    const result=await read(params('/api/rows',{editionId:e.id,table,offset,limit:100,facilityId,section}));
    if(sequence!==S.rowRequest||selected()?.id!==e.id||S.table!==table||S.facilityId!==facilityId||S.reportSection!==section)return;
    S.rows={...result,editionId:e.id,table,offset:result.offset??offset};
    if(S.section==='facilities')render();
  }catch(error){if(sequence===S.rowRequest)notice(errorText(error));}
}
async function loadSearch(){
  if(!S.searchId)return;
  const sequence=++S.searchRequest,id=S.searchId,offset=S.searchOffset;
  try{
    const value=await read(params('/api/search',{searchId:id,offset,limit:100}));
    if(sequence!==S.searchRequest||id!==S.searchId||offset!==S.searchOffset)return;
    S.searchPage=value;if(S.section==='portfolio')render();
  }catch(error){if(sequence===S.searchRequest)notice(errorText(error));}
}
function openSourceData(title,value){
  S.source=null;$('source-title').textContent=title;$('source-meta').textContent='';
  $('source-downloads').innerHTML='';$('source-body').textContent=pretty(value);
  if(!$('source-dialog').open)$('source-dialog').showModal();
}
async function sourceEdition(id){return selected()?.id===id?selected():await read(params('/api/edition',{editionId:id}));}
async function showRaw(editionId,index){
  const e=await sourceEdition(editionId),receipt=e.pages[index];if(!receipt)throw new Error('Choose an original response from this edition.');
  S.source={editionId,index,receipt};$('source-title').textContent=(receipt.kind??'Source')+' · original EPA response';
  $('source-meta').textContent=pretty(receipt);$('source-body').textContent='Reading original source…';
  $('source-downloads').innerHTML=button('Download original body','raw-download',{edition:editionId,page:index})+
    (receipt.responseSha256&&receipt.responseSha256!==receipt.sha256?button('Download original transport response','raw-download',{edition:editionId,page:index,wire:'true'}):'');
  if(!$('source-dialog').open)$('source-dialog').showModal();
  const text=await(await request(params('/api/raw',{editionId,page:index}))).text();
  if(S.source?.editionId===editionId&&S.source?.index===index)$('source-body').textContent=text;
}
async function downloadRaw(editionId,index,wire=false){
  const e=await sourceEdition(editionId),receipt=e.pages[index];if(!receipt)throw new Error('Choose an original response file.');
  const sha=wire?receipt.responseSha256??receipt.sha256:receipt.sha256;
  await download(params('/api/raw',{editionId,page:index,wire}),(receipt.kind??'source')+'-'+sha+(wire?'.response':'.json'));
}
async function showFacility(editionId,facilityId){
  const result=await read(params('/api/facility',{editionId,facilityId}));
  openSourceData('Original EPA facility '+facilityId,result);
  $('source-meta').textContent='Source edition '+editionId+' · FRS '+facilityId;
  $('source-downloads').innerHTML=button('Download original facility view','download',{url:params('/api/facility',{editionId,facilityId}),name:'epa-facility-'+facilityId+'.json'})+
    button('Add facility review','form',{kind:'review.save',editionId,facilityId});
}
function showRow(index){
  const row=S.rows?.rows[index];if(!row)return;
  openSourceData('Original '+S.table+' record',row);
  $('source-meta').textContent='Source edition '+selected().id;
  $('source-downloads').innerHTML=sourceButton(row,selected())+
    (row.facilityId?button('Original full facility','facility-detail',{edition:selected().id,id:row.facilityId}):'')+
    button('Add source review','form',{kind:'review.save',editionId:selected().id,facilityId:row.facilityId??'',subject:row.section??row.field??S.table});
}
async function showReceived(id){
  const value=await read(params('/api/received-workspace',{receiptId:id}));
  S.received=value;S.receivedId=id;S.receivedFilter='';S.receivedOffset=0;switchSection('receiving');
}
async function showReceivedFile(id,path){
  const selection={received:id,path};S.source=selection;
  $('source-title').textContent=path;$('source-meta').textContent='Original received workspace '+id;
  $('source-body').textContent='Reading the retained original file…';
  $('source-downloads').innerHTML=button('Download original file','download',{url:params('/api/received-workspace-file',{receiptId:id,path}),name:path.split('/').at(-1)});
  if(!$('source-dialog').open)$('source-dialog').showModal();
  const response=await request(params('/api/received-workspace-file',{receiptId:id,path})),content=await response.arrayBuffer();
  if(S.source!==selection)return;
  try{
    const text=new TextDecoder('utf-8',{fatal:true}).decode(content);
    $('source-body').textContent=text.length>1000000?text.slice(0,1000000)+'\n\nDisplay shows the first 1,000,000 characters. Download the complete original file above.':text;
  }catch{$('source-body').textContent='This original file contains binary bytes. Use its original download above.';}
}
function latestForModal(view){
  const modal=S.modal,values=formValues($('operation-form'));
  if(modal.kind.startsWith('portfolio.'))return {revision:view.revision,portfolios:values.portfolioId?view.portfolios.filter(p=>p.id===values.portfolioId):view.portfolios};
  if(modal.kind.startsWith('release.'))return {revision:view.revision,releases:values.releaseId?view.releases.filter(r=>r.id===values.releaseId):view.releases};
  if(modal.kind.startsWith('capture.'))return {revision:view.revision,portfolios:view.portfolios,captures:view.captures.filter(c=>!values.portfolioId||(c.portfolio?.id??c.portfolio)===values.portfolioId)};
  if(modal.kind==='review.save')return {revision:view.revision,reviews:view.reviews.filter(r=>r.editionId===values.editionId),selectedEditionId:view.selectedEditionId};
  return {revision:view.revision,selectedEditionId:view.selectedEditionId,editions:view.editions.map(e=>({id:e.id,portfolio:e.portfolio,complete:e.complete})),
    datasets:view.datasets.map(d=>({id:d.id,name:d.name,snapshot:d.snapshot})),receivedWorkspaces:view.receivedWorkspaces,
    operation:view.operations.find(o=>o.operationId===modal.pending?.operationId)??null};
}
async function reviewLatest(){
  if(!S.modal||S.modal.busy)return;
  try{const view=await read('/api/view');acceptView(view);S.modal.reviewedView=view;
    $('latest-view').textContent=pretty(latestForModal(view));$('latest-view').hidden=false;$('adopt-latest').disabled=false;
  }catch(error){$('dialog-error').textContent=errorText(error);}
}
function adoptLatest(){
  const modal=S.modal;if(!modal?.reviewedView)return;
  modal.expectedRevision=modal.reviewedView.revision;
  const generation=$('operation-form').elements.namedItem('expectedGeneration'),id=$('operation-form').elements.namedItem('releaseId')?.value;
  if(generation&&id){const value=currentGeneration(modal.reviewedView.releases.find(r=>r.id===id));if(value!==null)generation.value=value;}
  if(modal.pending)modal.pending.expectedRevision=modal.expectedRevision;
  $('form-revision').textContent='Reviewed original workspace revision '+modal.expectedRevision+'. Your entered values are retained.';
  $('dialog-error').textContent='The latest saved view is reviewed. Submit this retained form to continue.';clearConflict();saveDialog();
}
async function moreEditions(){
  const result=await read(params('/api/editions',{offset:S.editionOffset,limit:100}));
  S.editionOffset+=result.editions.length;for(const e of result.editions)if(!S.editions.some(x=>x.id===e.id))S.editions.push(e);
  S.view.editionCount=result.total;render();
}
function switchSection(section){
  if(!views.has(section))return;S.section=section;remember('section',section);render();
  if(section==='facilities')void loadRows();
  if(section==='portfolio'&&S.searchId&&!S.searchPage)void loadSearch();
}
function closeForm(){
  if(S.modal?.busy)return;saveDialog();$('dialog').close();S.modal=null;
  notice('The entered form is retained for this original workspace.',button('Reopen saved form','restore-form'));
}
function updateQueryOperators(){
  const form=$('operation-form');if(S.modal?.kind!=='dataset.query')return;
  const dataset=S.view.datasets.find(d=>d.id===form.elements.namedItem('datasetId').value),name=form.elements.namedItem('queryFilterField').value,
    iso=originalDateIso(dataset,name),select=form.elements.namedItem('queryFilterOperator');
  for(const option of select.options)option.disabled=Boolean(iso&&option.value!=='where');
  if(iso)select.value='where';
}
function buildQuery(){
  const form=$('operation-form');if(S.modal?.kind!=='dataset.query')return;
  const values=formValues(form),query=new URLSearchParams(values.query??''),limit=Number(values.queryLimit);
  if(!Number.isSafeInteger(limit)||limit<1)throw new Error('Choose a positive whole dataset page size.');
  query.set('limit',String(limit));query.delete('cursor');
  const fields=[...form.querySelectorAll('input[name="queryField"]:checked')].map(input=>input.value);
  if(fields.length)query.set('fields',fields.join(','));else query.delete('fields');
  if(values.querySort)query.set('sort',(values.queryDescending?'-':'')+values.querySort);else query.delete('sort');
  if(values.queryFilterField){
    const dataset=S.view.datasets.find(d=>d.id===values.datasetId),iso=originalDateIso(dataset,values.queryFilterField);
    if(iso&&values.queryFilterOperator!=='where')throw new Error('Choose '+iso+' for chronological filtering; '+values.queryFilterField+' retains the original display date.');
    query.set(values.queryFilterOperator+'_'+values.queryFilterField,values.queryFilterValue);
  }
  const keys=[...query.keys()];
  if(keys.length>32||keys.filter(k=>k.startsWith('where_')).length>8||keys.filter(k=>/^(gt|gte|lt|lte)_/.test(k)).length>8||(query.get('sort')??'').split(',').filter(Boolean).length>8)
    throw new Error('The original query supports up to 8 equality filters, ranges and sort columns, with 32 total parameters.');
  form.elements.namedItem('query').value=query.toString();saveDialog();
}
async function operate(target){
  const {op}=target.dataset;
  if(op==='form'){
    const context={...target.dataset};delete context.op;delete context.kind;
    if($('source-dialog').open)$('source-dialog').close();
    const draft=saved('dialog'),same=draft?.kind===target.dataset.kind&&JSON.stringify(draft.context)===JSON.stringify(context);
    openForm(target.dataset.kind,context,same?draft:null);return;
  }
  if(op==='section')return switchSection(target.dataset.section);
  if(op==='close-form')return closeForm();
  if(op==='restore-form'){const draft=saved('dialog');if(draft)openForm(draft.kind,draft.context,draft);return;}
  if(op==='archive-portfolio')return runAction('portfolio.archive',{portfolioId:target.dataset.id});
  if(op==='reopen-portfolio'){
    const p=S.view.portfolios.find(p=>p.id===target.dataset.id);
    if(p)return runAction('portfolio.save',{portfolioId:p.id,label:p.label,facilityIds:p.facilityIds,customer:p.customer,owner:p.owner,note:p.note,active:true});
    return;
  }
  if(op==='portfolio-detail')return openSourceData('Original portfolio and history',S.view.portfolios.find(p=>p.id===target.dataset.id));
  if(op==='search-open'){S.searchId=target.dataset.id;S.searchOffset=0;S.searchPage=null;render();return loadSearch();}
  if(op==='search-detail')return openSourceData('Original search source',S.view.searches.find(s=>s.id===target.dataset.id));
  if(op==='search-row')return openSourceData('Original facility search record',S.searchPage?.rows[Number(target.dataset.index)]);
  if(op==='use-facility')return openForm('portfolio.save',{facilityIds:target.dataset.id});
  if(op==='search-previous'){S.searchOffset=Math.max(0,S.searchOffset-100);return loadSearch();}
  if(op==='search-next'){S.searchOffset+=100;return loadSearch();}
  if(op==='capture-pause')return runAction('capture.pause',{captureId:target.dataset.id});
  if(op==='capture-resume')return runAction('capture.resume',{captureId:target.dataset.id});
  if(op==='select-edition')return runAction('edition.select',{editionId:target.dataset.id});
  if(op==='source')return showRaw(target.dataset.edition,Number(target.dataset.page));
  if(op==='raw-download')return downloadRaw(target.dataset.edition,Number(target.dataset.page),target.dataset.wire==='true');
  if(op==='download')return download(target.dataset.url,target.dataset.name);
  if(op==='facility-detail')return showFacility(target.dataset.edition,target.dataset.id);
  if(op==='row')return showRow(Number(target.dataset.index));
  if(op==='load-rows')return loadRows();
  if(op==='previous-rows'){S.offset=Math.max(0,S.offset-100);return loadRows();}
  if(op==='next-rows'){S.offset+=100;return loadRows();}
  if(op==='more-editions')return moreEditions();
  if(op==='build-query')return buildQuery();
  if((op==='query-next'||op==='query-first')&&S.querySelection){
    const query=new URLSearchParams(S.querySelection.query);query.delete('cursor');
    if(op==='query-next'&&S.queryResult?.page?.nextCursor)query.set('cursor',S.queryResult.page.nextCursor);
    return runAction('dataset.query',{datasetId:S.querySelection.datasetId,query:query.toString()});
  }
  if(op==='dataset-detail')return openSourceData('Original prepared dataset',S.view.datasets.find(d=>d.id===target.dataset.id));
  if(op==='export-detail')return openSourceData('Original retained export',S.view.exports.find(e=>e.id===target.dataset.id));
  if(op==='release-inspect')return runAction('release.inspect',{releaseId:target.dataset.id});
  if(op==='release-stop')return runAction('release.stop',{releaseId:target.dataset.id});
  if(op==='receive-selected')return openForm('buyer.receive',{intentIds:S.buyerResult.intentIds??S.buyerResult.items.map(i=>i.intentId)});
  if(op==='workspace-export')return runAction('workspace.export',{});
  if(op==='received-open')return showReceived(target.dataset.id);
  if(op==='received-detail')return openSourceData('Original received workspace metadata',S.view.receivedWorkspaces.find(r=>r.id===target.dataset.id));
  if(op==='received-file')return showReceivedFile(target.dataset.id,target.dataset.path);
  if(op==='received-previous'){S.receivedOffset=Math.max(0,(S.receivedOffset??0)-100);render();return;}
  if(op==='received-next'){S.receivedOffset=(S.receivedOffset??0)+100;render();return;}
  if(op==='retry-action'&&S.pending)return runAction(S.pending.action,S.pending.payload,S.pending);
  if(op==='inspect-pending'){
    if(!S.pending)return;
    const payload={...S.pending.payload};if(payload.bundle)payload.bundle={schema:payload.bundle.schema,selection:payload.bundle.selection,sourcePages:(payload.bundle.responses??[]).length};
    return openSourceData('Original retained action',{...S.pending,payload,operation:S.view.operations.find(o=>o.operationId===S.pending.operationId)??null});
  }
  if(op==='source-contract')return openSourceData('Original EPA source contract',S.schema.source??S.schema.sourceContract??S.schema);
  if(op==='open-export'){
    const item=S.view.exports.find(e=>e.id===target.dataset.id);if(!item)return;
    const result=await read(item.downloadUrl);
    if(item.kind==='comparison'){S.comparison={...result,export:item};switchSection('editions');}
    else openSourceData(item.name,result);
  }
}
document.addEventListener('click',event=>{
  const target=event.target.closest('button[data-op]');if(!target||target.disabled)return;
  event.preventDefault();void operate(target).catch(error=>{if(S.modal)$('dialog-error').textContent=errorText(error);else notice(errorText(error));});
});
document.querySelectorAll('nav [data-view]').forEach(button=>button.addEventListener('click',()=>switchSection(button.dataset.view)));
$('refresh').addEventListener('click',()=>void refresh());
$('dialog-close').addEventListener('click',closeForm);
$('dialog').addEventListener('cancel',event=>{if(S.modal?.busy){event.preventDefault();return;}saveDialog();S.modal=null;});
$('source-close').addEventListener('click',()=>{$('source-dialog').close();S.source=null;});
$('source-dialog').addEventListener('cancel',()=>{S.source=null;});
$('review-latest').addEventListener('click',()=>void reviewLatest());
$('adopt-latest').addEventListener('click',adoptLatest);
document.addEventListener('change',event=>{
  if(event.target.id==='f-report-table'){S.table=event.target.value;S.offset=0;S.rows=null;remember('table',S.table);render();void loadRows();}
  if(event.target.id==='f-facility-filter'){S.facilityId=event.target.value;S.offset=0;S.rows=null;render();void loadRows();}
  if(event.target.id==='f-section-filter'){S.reportSection=event.target.value;S.offset=0;S.rows=null;render();void loadRows();}
  if(event.target.id==='f-queryFilterField')updateQueryOperators();
  if(event.target.id==='f-datasetId'&&S.modal?.kind==='dataset.query'){
    $('query-builder-host').innerHTML=queryBuilder(S.view.datasets.find(d=>d.id===event.target.value),$('operation-form').elements.namedItem('query').value);saveDialog();
  }
});
let filterTimer;
document.addEventListener('input',event=>{
  const keys={'f-record-filter':'recordFilter','f-portfolio-filter':'portfolioFilter','f-received-filter':'receivedFilter'};
  const key=keys[event.target.id];if(!key)return;
  const id=event.target.id,position=event.target.selectionStart;S[key]=event.target.value;remember(key,S[key]);if(key==='receivedFilter')S.receivedOffset=0;
  clearTimeout(filterTimer);filterTimer=setTimeout(()=>{render();const input=$(id);if(input){input.focus();input.setSelectionRange(position,position);}},180);
});
async function begin(){
  if(!token){notice('Open the private EPA ECHO session URL printed by the original application.');return;}
  try{
    S.schema=await read('/api/schema');
    if(typeof S.schema.workspaceId!=='string')throw new Error('The original workspace did not return its stable identity.');
    storageKey='epa-echo:workspace:'+S.schema.workspaceId+':';
    S.section=saved('section','portfolio');if(!views.has(S.section))S.section='portfolio';
    S.table=saved('table','');if(!tableDefinitions().some(t=>t.id===S.table))S.table=tableDefinitions()[0]?.id??'';
    S.pending=saved('pending');for(const name of ['recordFilter','portfolioFilter'])S[name]=saved(name,'');
    await refresh({quiet:true});
    if(S.pending)notifyPending();else if(saved('dialog'))notice('A saved form is retained for this original workspace.',button('Reopen saved form','restore-form'));
    setInterval(()=>{if(!document.hidden&&S.view?.captures.some(c=>['RUNNING','QUEUED'].includes(c.state)))void refresh({quiet:true});},4000);
  }catch(error){notice(errorText(error));}
}
void begin();
