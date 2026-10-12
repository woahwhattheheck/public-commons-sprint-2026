// MIT. Staff console over the original retained NWS workspace and merchant engines.
const $=id=>document.getElementById(id);
const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const pretty=value=>JSON.stringify(value,null,2);
const short=value=>String(value??'').slice(0,12);
const badge=value=>'<span class="badge">'+esc(String(value??'unknown').replaceAll('_',' '))+'</span>';
const when=value=>value?esc(value):'Not supplied';
const bytes=value=>Number.isFinite(value)?new Intl.NumberFormat().format(value)+' bytes':'Not supplied';
const storageKey='nws:'+location.origin+':';
function saved(key,fallback=null){try{return JSON.parse(sessionStorage.getItem(storageKey+key))??fallback;}catch{return fallback;}}
function remember(key,value){try{if(value===null)sessionStorage.removeItem(storageKey+key);else sessionStorage.setItem(storageKey+key,JSON.stringify(value));return true;}catch{return false;}}
let token=location.hash.slice(1);
if(token){sessionStorage.setItem(storageKey+'token',token);history.replaceState(null,'',location.pathname+location.search);}
else token=sessionStorage.getItem(storageKey+'token');
const S={schema:null,view:null,section:saved('section','portfolio'),table:saved('table','forecast'),offset:0,rows:null,
  editions:[],editionOffset:0,comparison:null,queryResult:null,buyerResult:null,modal:null,source:null,pending:saved('pending'),refreshing:false,
  rowRequest:0,weatherFilter:saved('weatherFilter',''),siteFilter:saved('siteFilter',''),operationBusy:false};
const views=new Set(['portfolio','captures','weather','editions','notes','publishing','receiving']);
if(!views.has(S.section))S.section='portfolio';
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
function notifyPending(){
  if(S.pending)notice('A saved action is awaiting its result. Reuse its original request to continue: '+S.pending.action+'.',
    button('Continue saved action','retry-action')+button('Inspect operation','inspect-pending'));
}
function errorText(error){return (error.message||String(error))+(error.retryAt?' Retry after '+error.retryAt+'.':'')+(error.operationId?' Operation '+error.operationId+'.':'');}
async function request(path,options={}){
  const response=await fetch(path,{...options,headers:{Authorization:'Bearer '+token,...options.headers}});
  if(!response.ok){let body;try{body=await response.json();}catch{}
    throw Object.assign(new Error(body?.message??'The workspace returned HTTP '+response.status+'.'),body??{},{status:response.status});}
  return response;
}
const read=async path=>(await request(path)).json();
const params=(path,values)=>path+'?'+new URLSearchParams(Object.entries(values).filter(([,v])=>v!==undefined&&v!==null));
const selected=()=>S.view?.selectedEdition;
const editionLabel=e=>e.site.label+' · '+(e.label||'Edition')+' · '+short(e.id)+' · '+(e.complete?'complete':'partial');
const allEditions=()=>S.editions;
function acceptView(view){
  S.editionOffset=Math.max(view.editions.length,S.editionOffset+Math.max(0,view.editionCount-(S.view?.editionCount??view.editionCount)));
  S.view=view;
  const older=S.editions.filter(e=>!view.editions.some(r=>r.id===e.id));
  S.editions=[...view.editions,...older];
  if(view.selectedEdition&&!S.editions.some(e=>e.id===view.selectedEdition.id))S.editions.push(view.selectedEdition);
  $('workspace-id').textContent='Workspace '+short(view.workspaceId)+' · revision '+view.revision;
  const e=selected();
  $('current-edition').innerHTML=e?'<strong>'+esc(e.site.label)+'</strong><p>'+badge(e.complete?'Complete':'Partial')+'</p><code>'+esc(short(e.id))+'</code><p>'+esc(e.pageCount)+' source pages</p>':'Choose a source capture.';
}
async function refresh({quiet=false}={}){
  if(S.refreshing)return;
  S.refreshing=true;$('refresh').disabled=true;
  try{const old=selected()?.id;acceptView(await read('/api/view'));render();
    if(S.section==='weather'&&(old!==selected()?.id||!S.rows))await loadRows();
    if(!quiet)notifyPending();
  }catch(error){notice(errorText(error));}
  finally{S.refreshing=false;$('refresh').disabled=false;}
}
async function download(path,name){
  const response=await request(path),blob=await response.blob(),url=URL.createObjectURL(blob),a=document.createElement('a');
  a.href=url;a.download=name||'weather-source';document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),30000);
}
function field(name,label,{type='text',value='',options=[],help='',full=false,required=false,readonly=false,placeholder=''}={}){
  if(type==='hidden')return '<input type="hidden" name="'+esc(name)+'" value="'+esc(value)+'">';
  let control;
  if(type==='textarea')control='<textarea name="'+esc(name)+'" id="f-'+esc(name)+'"'+(required?' required':'')+(readonly?' readonly':'')+' placeholder="'+esc(placeholder)+'">'+esc(value)+'</textarea>';
  else if(type==='select')control='<select name="'+esc(name)+'" id="f-'+esc(name)+'"'+(required?' required':'')+'>'+options.map(option=>{
    const [id,title]=Array.isArray(option)?option:[option,option];
    return '<option value="'+esc(id)+'"'+(String(id)===String(value)?' selected':'')+'>'+esc(title)+'</option>';
  }).join('')+'</select>';
  else if(type==='checkbox')control='<label class="check"><input type="checkbox" name="'+esc(name)+'" id="f-'+esc(name)+'"'+(value?' checked':'')+'>'+esc(label)+'</label>';
  else control='<input id="f-'+esc(name)+'" name="'+esc(name)+'" type="'+esc(type)+'"'+(type!=='file'?' value="'+esc(value)+'"':' accept=".json,application/json"')+
    (required?' required':'')+(readonly?' readonly':'')+(type==='number'?' step="any"':'')+' placeholder="'+esc(placeholder)+'">';
  return '<div class="field'+(full?' full':'')+'">'+(type!=='checkbox'?'<label for="f-'+esc(name)+'">'+esc(label)+'</label>':'')+control+(help?'<p class="help">'+esc(help)+'</p>':'')+'</div>';
}
function formValues(form){
  const values={};
  for(const element of form.elements){
    if(!element.name||element.type==='file'||element.type==='submit')continue;
    if(element.name==='products'){values.products??=[];if(element.checked)values.products.push(element.value);}
    else values[element.name]=element.type==='checkbox'?element.checked:element.value;
  }
  return values;
}
function applyValues(form,values){
  for(const element of form.elements){
    if(!element.name||element.type==='file'||values[element.name]===undefined)continue;
    if(element.name==='products')element.checked=values.products.includes(element.value);
    else if(element.type==='checkbox')element.checked=values[element.name]===true;
    else element.value=values[element.name];
  }
}
function saveDialog(){
  const modal=S.modal;if(!modal||!$('operation-form'))return;
  const item={kind:modal.kind,context:modal.context,expectedRevision:modal.expectedRevision,values:formValues($('operation-form')),pending:modal.pending??null};
  if(!remember('dialog',item))$('dialog-error').textContent='The browser could not retain this large form for a page reload. It remains open with its original action in this session.';
}
function clearConflict(){
  $('dialog-conflict').hidden=true;$('latest-view').hidden=true;$('latest-view').textContent='';$('adopt-latest').disabled=true;
  if(S.modal){S.modal.reviewedView=null;S.modal.conflict=false;}
}
function modalFields(kind,context){
  const e=selected(),site=S.view.sites.find(x=>x.id===context.id),editionOptions=allEditions().map(e=>[e.id,editionLabel(e)]),
    sites=S.view.sites.filter(s=>s.active).map(s=>[s.id,s.label]),tableOptions=S.schema.tables.map(t=>[t.id,t.label]);
  const editionField=(name='editionId',value=e?.id)=>field(name,'Source edition',{type:'select',options:editionOptions,value,required:true,full:true});
  if(kind==='site.save')return {title:site?'Edit site':'Add a site',submit:'Save site',html:
    field('siteId','',{type:'hidden',value:site?.id??''})+
    field('label','Site name',{value:site?.label??'',required:true})+field('owner','Responsible team or owner',{value:site?.owner??''})+
    field('latitude','Latitude',{type:'number',value:site?.latitude??'',required:true,help:'Decimal degrees. The source point uses four decimal places.'})+
    field('longitude','Longitude',{type:'number',value:site?.longitude??'',required:true})+
    field('stationId','Preferred observation station',{value:site?.stationId??'',help:'Leave empty to use the first station in the current NWS catalog.'})+
    field('active','Site is active',{type:'checkbox',value:site?.active??true})+
    field('note','Site instructions',{type:'textarea',value:site?.note??'',full:true})};
  if(kind==='capture.start'){
    const end=new Date().toISOString(),start=new Date(Date.parse(end)-86400000).toISOString();
    return {title:'Capture current NWS source',submit:'Start source capture',html:
      field('siteId','Site',{type:'select',options:sites,value:context.id??sites[0]?.[0],required:true,full:true})+
      field('label','Edition label',{value:context.label??'',help:'Optional staff label for this source capture.',full:true})+
      field('observationStart','Observation interval start',{value:start,required:true,help:'ISO 8601 with Z or a numeric UTC offset.'})+
      field('observationEnd','Observation interval end',{value:end,required:true})+
      field('units','Forecast units',{type:'select',options:[['us','US forecast units'],['si','SI forecast units']],value:'us',
        help:'Grid and observation values keep the provider’s original unit codes.',full:true})+
      '<div class="field full"><label>Weather products</label><div class="checks">'+S.schema.products.map(p=>'<label class="check"><input type="checkbox" name="products" value="'+esc(p)+'" checked>'+esc(p)+'</label>').join('')+'</div><p class="help">All returned source pages are retained. Point discovery and the observation station catalog travel with the capture.</p></div>'};
  }
  if(kind==='capture.import')return {title:'Import a retained source package',submit:'Import original source',html:
    field('siteId','Matching saved site',{type:'select',options:sites,value:context.id??sites[0]?.[0],required:true,full:true})+
    field('label','Edition label',{value:'',full:true})+
    field('file','NWS source package',{type:'file',help:'Select a complete source-package JSON. The saved site must have the package’s coordinates. Original response bytes and source times are retained.',full:true})};
  if(kind==='capture.station'){
    const capture=S.view.captures.find(c=>c.id===context.id);
    return {title:'Choose an observation station',submit:'Use station and continue',html:
      field('captureId','',{type:'hidden',value:capture.id})+
      field('stationId','Station from this capture',{type:'select',options:capture.stationCatalog.map(s=>[s.id,s.id+' · '+s.name]),value:capture.station?.id??capture.stationCatalog[0]?.id,full:true,required:true})};
  }
  if(kind==='edition.compare')return {title:'Compare two source editions',submit:'Compare editions',html:
    editionField('leftId',context.leftId??allEditions()[1]?.id??e?.id)+editionField('rightId',context.rightId??e?.id)+
    field('table','Weather table',{type:'select',options:tableOptions,value:S.table,full:true}),
    help:'Choose the same saved site and forecast units. Observation comparisons also use the same station.'};
  if(kind==='annotation.save'){
    const note=S.view.annotations.find(a=>a.id===context.id);
    return {title:note?'Update staff review':'Add staff review',submit:'Save review',html:
      editionField('editionId',note?.editionId??context.editionId??e?.id)+
      field('subject','Review subject',{value:note?.subject??context.subject??'',readonly:Boolean(note),required:true,full:true})+
      field('status','Review status',{type:'select',options:[['open','Open'],['reviewed','Reviewed'],['follow_up','Follow-up required']],value:note?.status??'open',full:true})+
      field('note','Decision, source details and follow-up',{type:'textarea',value:note?.note??'',full:true})};
  }
  if(kind==='dataset.prepare')return {title:'Prepare an original dataset',submit:'Prepare dataset',html:editionField()+
    field('table','Weather table',{type:'select',options:tableOptions,value:S.table,full:true})+
    field('name','Dataset name',{value:e?e.site.label+' · '+S.table:'',required:true,full:true}),
    help:'The selected source table becomes an original SF30 dataset with its complete NWS response package.'};
  if(kind==='dataset.query'){
    const dataset=S.view.datasets.find(d=>d.id===context.id)??S.view.datasets[0];
    return {title:'Query original dataset',submit:'Run dataset query',html:
      field('datasetId','Dataset',{type:'select',options:S.view.datasets.map(d=>[d.id,d.name]),value:dataset?.id,required:true,full:true})+
      field('query','Dataset query string',{type:'textarea',value:context.query??'limit=50',full:true,
        help:'Use the original query contract: limit=50, where_field=temperature, sort=-validFromUtc and gte_validFromUtc=an-ISO-UTC-instant. The next page uses the returned cursor.'})+
      '<div class="field full">'+details('Selected dataset description',dataset?.description??{})+'</div>'};
  }
  if(kind==='release.prepare')return {title:'Prepare a dataset release',submit:'Prepare original release',html:
    field('datasetId','Dataset',{type:'select',options:S.view.datasets.map(d=>[d.id,d.name]),value:context.id??S.view.datasets[0]?.id,required:true,full:true})+
    field('origin','Public dataset origin',{type:'url',value:'',placeholder:'https://weather.example.org',required:true,full:true})+
    field('path','Dataset route',{value:'/weather',required:true})+
    field('scheme','Payment scheme',{value:'exact',required:true})+
    field('network','Payment network',{value:'stellar:testnet',required:true})+
    field('asset','Asset contract',{value:'',required:true,help:'Use the asset contract from the reviewed seller configuration.'})+
    field('amount','Atomic amount per request',{value:'',required:true,help:'Use an integer amount in the selected asset’s atomic units.'})+
    field('payTo','Merchant account',{value:'',required:true})+
    field('maxTimeoutSeconds','Payment timeout in seconds',{type:'number',value:300,required:true}),
    help:'This prepares the original publisher and release store. Choose the reviewed merchant and network for this dataset.'};
  if(['release.activate','release.start','release.rollback'].includes(kind)){
    const release=S.view.releases.find(r=>r.id===context.id);
    return {title:kind.split('.')[1][0].toUpperCase()+kind.split('.')[1].slice(1)+' dataset release',submit:kind.split('.')[1]+' release',html:
      field('releaseId','Release',{value:release.id,readonly:true,full:true})+
      field('expectedGeneration','Displayed release generation',{type:'number',value:release.selection?.generation??release.publisher?.releases?.state?.generation??0,readonly:true,full:true})+
      '<div class="field full">'+details('Selected original publisher',release.publisher??release)+'</div>',
      help:kind==='release.rollback'?'The original release store selects its previous retained version.':'This uses the selected dataset’s original publisher process and release store.'};
  }
  if(kind==='buyer.inspect'||kind==='buyer.receive')return {title:kind==='buyer.inspect'?'Inspect original buyer intents':'Receive customer dataset',submit:kind==='buyer.inspect'?'Inspect intents':'Receive original delivery',html:
    field('intentIds','Original inbox intent IDs, in page order',{type:'textarea',value:context.intentIds?.join('\n')??saved('intentIds',[]).join('\n'),required:true,full:true,
      help:'Enter one original SF88 inbox intent ID per line. The receiving engine assembles these retained outcomes in this order.'})};
  if(kind==='export.create')return {title:'Export source edition',submit:'Create export',html:
    editionField()+field('table','Weather table',{type:'select',options:tableOptions,value:S.table,full:true})+
    field('format','Export format',{type:'select',options:[['json','JSON review with source metadata'],['csv','Spreadsheet CSV'],['report','Printable HTML review'],['source-package','Complete source package for another workspace']],value:context.format??'json',full:true}),
    help:'The portable source package includes original response bodies, capture scope, source metadata and staff annotations.'};
  throw new Error('This form is not available.');
}
function openForm(kind,context={},restoring=null){
  if(!S.view)return;
  const definition=modalFields(kind,context),pending=restoring?.pending??null;
  S.modal={kind,context,expectedRevision:restoring?.expectedRevision??S.view.revision,pending,busy:false,reviewedView:null,conflict:false};
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
  if(modal.kind==='site.save'){values.latitude=Number(values.latitude);values.longitude=Number(values.longitude);if(!values.siteId)delete values.siteId;}
  if(modal.kind==='capture.start'&&!values.label)delete values.label;
  if(modal.kind==='capture.import'){
    const file=$('operation-form').elements.namedItem('file').files[0];
    let bundle;
    if(file){if(file.size>60*1024*1024)throw new Error('Choose a source package below60 MiB for this browser import.');bundle=JSON.parse(await file.text());}
    else bundle=modal.pending?.payload?.bundle;
    if(!bundle)throw new Error('Choose the complete retained NWS source package.');
    values.bundle=bundle;if(!values.label)delete values.label;
  }
  if(modal.kind==='release.prepare'){
    values.payment={};for(const name of S.schema.paymentFields){values.payment[name]=name==='maxTimeoutSeconds'?Number(values[name]):values[name];delete values[name];}
  }
  if(modal.kind.startsWith('release.')&&Object.hasOwn(values,'expectedGeneration'))values.expectedGeneration=Number(values.expectedGeneration);
  if(modal.kind.startsWith('buyer.')){
    values.intentIds=values.intentIds.split(/[\s,]+/).filter(Boolean);remember('intentIds',values.intentIds);
  }
  return values;
}
async function postAction(requestValue){
  return (await request('/api/action',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(requestValue)})).json();
}
function sameAction(a,action,payload){return a?.action===action&&JSON.stringify(a.payload)===JSON.stringify(payload);}
async function submitForm(){
  const modal=S.modal;if(!modal||modal.busy)return;
  const form=$('operation-form');if(!form.reportValidity())return;
  modal.busy=true;for(const element of form.querySelectorAll('button'))element.disabled=true;$('dialog-close').disabled=true;
  $('dialog-error').textContent='';
  try{
    const payload=await payloadOf(modal);
    if(!sameAction(modal.pending,modal.kind,payload))modal.pending={action:modal.kind,payload,expectedRevision:modal.expectedRevision,operationId:crypto.randomUUID()};
    saveDialog();
    const result=await postAction(modal.pending);
    if(result.view)acceptView(result.view);
    if(!Object.hasOwn(result,'result')){$('dialog-error').textContent='The original operation is still running. Submit this unchanged form again to read its result.';return;}
    remember('dialog',null);modal.pending=null;
    $('dialog').close();S.modal=null;clearConflict();handleResult(modal.kind,result.result,payload);render();
    if(S.section==='weather')await loadRows();
  }catch(error){
    $('dialog-error').textContent=errorText(error);
    if(error.status===409){
      modal.conflict=true;$('dialog-conflict').hidden=false;$('adopt-latest').disabled=true;
      if(error.view)acceptView(error.view);
    }
    saveDialog();
  }finally{modal.busy=false;for(const element of form.querySelectorAll('button'))element.disabled=false;$('dialog-close').disabled=false;}
}
async function runAction(action,payload={},existing=null){
  if(S.operationBusy)return;
  if(S.pending&&!existing&&!sameAction(S.pending,action,payload)){notifyPending();return;}
  const pending=existing??(sameAction(S.pending,action,payload)?S.pending:{action,payload,operationId:crypto.randomUUID(),expectedRevision:S.view.revision});
  S.pending=pending;remember('pending',pending);S.operationBusy=true;
  try{
    const result=await postAction(pending);if(result.view)acceptView(result.view);
    if(!Object.hasOwn(result,'result')){notifyPending();render();return;}
    S.pending=null;remember('pending',null);handleResult(action,result.result,pending.payload);render();
    if(S.section==='weather')await loadRows();
  }catch(error){
    if(error.view)acceptView(error.view);
    const operation=S.view?.operations.find(o=>o.operationId===pending.operationId);
    if(error.status===409&&!operation){
      S.pending=null;remember('pending',null);
      notice(errorText(error)+' The new action was not reserved. The latest saved view is shown; select the action again after review.');
    }else notice(errorText(error),button('Continue saved action','retry-action')+button('Inspect operation','inspect-pending'));
    render();
  }finally{S.operationBusy=false;}
}
function handleResult(action,result,payload={}){
  if(action==='edition.compare'){S.comparison=result;S.section='editions';}
  else if(action==='dataset.query'){S.queryResult=result;S.querySelection={datasetId:payload.datasetId,query:payload.query};S.section='publishing';}
  else if(action==='buyer.inspect'){S.buyerResult=result;S.section='receiving';}
  else if(action==='buyer.receive')S.section='receiving';
  else if(action==='edition.select'){S.section='weather';S.offset=0;S.rows=null;}
  else if(action.startsWith('capture.')){S.section='captures';S.rows=null;}
  else if(action==='annotation.save')S.section='notes';
  else if(action==='dataset.prepare'||action.startsWith('release.'))S.section='publishing';
  else if(action.startsWith('site.'))S.section='portfolio';
  else if(action==='export.create')S.section='receiving';
  remember('section',S.section);
  const labels={'site.save':'Site saved.','site.archive':'Site archived.','capture.start':'The source capture is saved and collecting its original responses.',
    'capture.import':'The retained source package is importing into this workspace.','capture.resume':'The original capture is continuing.',
    'capture.pause':'The capture will stop after retaining its completed source.','capture.station':'Station selected; the capture is continuing.',
    'edition.select':'Source edition selected.','edition.compare':'Edition comparison saved.','annotation.save':'Staff review saved.',
    'dataset.prepare':'Original dataset prepared.','dataset.query':'Dataset query completed.','release.prepare':'Original dataset release prepared.',
    'release.inspect':'Original release inspected.','release.activate':'Original release activated.','release.start':'Original publisher started.',
    'release.stop':'Original publisher stopped.','release.rollback':'Original release selection rolled back.','buyer.inspect':'Original buyer intents inspected.',
    'buyer.receive':'Customer files received from the original inbox.','export.create':'Edition export created.'};
  notice(labels[action]??'Workspace action completed.',result?.downloadUrl?button('Download '+result.format,'download',{url:result.downloadUrl,name:result.name}):'');
  if(action==='release.inspect')openSourceData('Original release',result);
}

function render(){
  if(!S.view)return;
  for(const item of document.querySelectorAll('nav [data-view]'))item.setAttribute('aria-current',item.dataset.view===S.section?'page':'false');
  const sections={portfolio:renderPortfolio,captures:renderCaptures,weather:renderWeather,editions:renderEditions,notes:renderNotes,publishing:renderPublishing,receiving:renderReceiving};
  $('content').innerHTML=sections[S.section]();
}
function renderPortfolio(){
  const sites=S.view.sites,active=sites.filter(s=>s.active),captures=S.view.captures;
  let body=heading('Sites','Manage the places your team follows, their owners and their original NWS source editions.',
    button('Add site','form',{kind:'site.save'},true));
  body+=metrics([[active.length,'Active sites'],[S.view.editionCount,'Retained editions'],[captures.filter(c=>['RUNNING','QUEUED'].includes(c.state)).length,'Captures running'],[S.view.annotations.filter(n=>n.status==='follow_up').length,'Follow-up notes']]);
  if(!sites.length)return body+empty('Add your first site','Choose a US location by latitude and longitude. Each capture discovers its current forecast office, grid cell and observation station catalog.',button('Add site','form',{kind:'site.save'},true));
  const filtered=sites.filter(s=>!S.siteFilter||(s.label+' '+s.owner+' '+s.note).toLowerCase().includes(S.siteFilter.toLowerCase()));
  body+='<div class="toolbar">'+field('site-filter','Find a site',{value:S.siteFilter,placeholder:'Site, owner or instructions'})+'</div>';
  body+=records(['Site','Owner and location','Recent source','Actions'],filtered.map(site=>{
    const latest=captures.find(c=>c.site.id===site.id),edition=S.editions.find(e=>e.site.id===site.id);
    return ['<strong>'+esc(site.label)+'</strong><p>'+badge(site.active?'active':'archived')+'</p><code>'+esc(short(site.id))+'</code>',
      '<strong>'+esc(site.owner||'Unassigned')+'</strong><p>'+esc(site.latitude)+', '+esc(site.longitude)+'</p><p>'+esc(site.note||'No site instructions.')+'</p><small>Station: '+esc(site.stationId||'Current provider catalog')+'</small>',
      latest?badge(latest.state)+'<p>'+esc(latest.label)+'</p><small>'+esc(latest.pageCount)+' source pages</small>':'No capture yet',
      actions(button('Edit','form',{kind:'site.save',id:site.id})+
        (site.active?button('Capture','form',{kind:'capture.start',id:site.id})+button('Import source','form',{kind:'capture.import',id:site.id})+
          button('Archive','archive-site',{id:site.id}):button('Reopen site','reopen-site',{id:site.id}))+
        (edition?button('Open edition','select-edition',{id:edition.id}):''))];
  }));
  body+='<section class="panel"><h2>How source capture works</h2><p>The current point response selects the forecast office and grid. Forecasts, hourly periods, raw grid intervals, observation stations, the selected observation interval, active alerts and recent alert history remain attached to the resulting edition.</p><p class="help">Changing a site preserves its previous settings on existing editions. A station saved on the site is selected only when it appears in that capture’s actual catalog.</p></section>';
  return body;
}
function captureCoverage(c){
  return '<div class="coverage">'+c.tasks.map(t=>'<div><strong>'+esc(t.kind)+'</strong>'+badge(t.state)+'<p>'+esc(t.records??0)+' records · '+esc(t.pages.length)+' pages</p>'+
    (t.termination?'<p class="help">'+esc(t.termination.replaceAll('_',' '))+'</p>':'')+
    (t.error?'<p>'+esc(t.error.message)+'</p>':'')+
    (t.retryAt?'<p class="help">Retry after '+esc(t.retryAt)+'</p>':'')+'</div>').join('')+'</div>';
}
function renderCaptures(){
  let body=heading('Source captures','Continue the same capture, inspect its coverage and open each retained source edition.',
    button('Capture site','form',{kind:'capture.start'},true)+button('Import source','form',{kind:'capture.import'}));
  if(!S.view.sites.some(s=>s.active))return body+empty('Add an active site','A source capture belongs to a saved site.',button('Add site','form',{kind:'site.save'},true));
  if(!S.view.captures.length)return body+empty('No source captures yet','Capture the current NWS resource graph or import a complete retained source package.',button('Capture site','form',{kind:'capture.start'},true));
  body+=S.view.captures.map(c=>{
    const controls=(c.editionId?button('Open edition','select-edition',{id:c.editionId}):'')+
      (['RUNNING','QUEUED'].includes(c.state)?button('Pause','capture-pause',{id:c.id}):c.state!=='COMPLETE'?button('Continue capture','capture-resume',{id:c.id}):'')+
      (c.stationRequired?button('Choose station','form',{kind:'capture.station',id:c.id},true):'');
    return '<section class="panel"><div class="heading"><div><h2>'+esc(c.label)+'</h2><p>'+esc(c.site.label)+' · '+badge(c.state)+'</p><code>'+esc(c.id)+'</code></div>'+actions(controls)+'</div>'+
      '<p>'+esc(c.pageCount)+' retained pages · '+bytes(c.byteCount)+' · station '+esc(c.station?.id||'pending source selection')+'</p>'+
      '<p class="help">Observation interval '+esc(c.query.observationStart)+' to '+esc(c.query.observationEnd)+'. Forecast units '+esc(c.query.units)+'.</p>'+
      (c.error?'<p>'+esc(c.error.message)+'</p>':'')+captureCoverage(c)+
      details('Point mapping and selected source query',{mapping:c.mapping,station:c.station,query:c.query})+
      details('Captured source responses',c.pageReceipts)+
      (c.failedResponses.length?details('Retained provider error responses',c.failedResponses):'')+
      (c.sourceMetadata?details('Imported source origin',c.sourceMetadata):'')+'</section>';
  }).join('');
  return body;
}
function editionOverview(e){
  const sum=e.summary;
  return '<section class="panel"><div class="heading"><div><h2>'+esc(e.site.label)+'</h2><p>'+esc(e.label)+' · '+badge(e.complete?'complete capture':'partial capture')+'</p><code>'+esc(e.id)+'</code></div>'+
    actions(button('Add review','form',{kind:'annotation.save',editionId:e.id})+button('Export','form',{kind:'export.create'}))+'</div>'+
    metrics([[sum.tables.find(t=>t.id==='forecast')?.rows??0,'Forecast periods'],[sum.activeAlerts,'Active source alerts'],[sum.historicalAlerts,'Recent source alerts'],[e.pageCount,'Retained response pages']])+
    '<div class="row-details"><dt>Current source mapping</dt><dd>'+esc(e.mapping?.gridId??'Not supplied')+' '+esc(e.mapping?.gridX??'')+','+esc(e.mapping?.gridY??'')+
    ' · '+esc(e.mapping?.timeZone??'No source time zone')+'</dd><dt>Selected station</dt><dd>'+esc(e.station?.id??'Unavailable')+' · '+esc(e.station?.name??'')+'</dd>'+
    '<dt>Latest captured observation</dt><dd>'+when(sum.latestCapturedObservation)+'</dd>'+
    '<dt>Observation interval</dt><dd>'+when(e.query.observationStart)+' to '+when(e.query.observationEnd)+'</dd>'+
    '<dt>Source retrieval</dt><dd>'+(sum.firstSourceObservedAt?when(sum.firstSourceObservedAt)+(sum.lastSourceObservedAt!==sum.firstSourceObservedAt?' to '+when(sum.lastSourceObservedAt):''):
      sum.retrievedDates.length?esc(sum.retrievedDates.join(', '))+' (date supplied by source capture)':'Not supplied by source capture')+'</dd></div>'+
    details('Complete source coverage',e.coverage)+'</section>';
}
function renderWeather(){
  const e=selected();
  let body=heading('Weather review','Inspect source values and intervals alongside their original responses.',
    e?button('Prepare dataset','form',{kind:'dataset.prepare'},true):'');
  if(!e)return body+empty('Choose a source edition','Open a completed or partial capture to review its retained data.',button('Open captures','section',{section:'captures'}));
  body+=editionOverview(e);
  body+='<div class="toolbar">'+field('weather-table','Weather table',{type:'select',options:S.schema.tables.map(t=>[t.id,t.label+' · '+(e.summary.tables.find(x=>x.id===t.id)?.rows??0)+' rows']),value:S.table})+
    field('weather-filter','Filter the displayed page',{value:S.weatherFilter,placeholder:'Field, value, description or source ID'})+button('Refresh rows','load-rows')+'</div>';
  if(!S.rows||S.rows.editionId!==e.id||S.rows.table!==S.table)return body+'<p>Loading original source rows…</p>';
  const all=S.rows.rows,needle=S.weatherFilter.toLowerCase(),rows=all.map((row,index)=>({row,index})).filter(({row})=>!needle||
    [row.field,row.value,row.label,row.description,row.recordId,row.stationId].join(' ').toLowerCase().includes(needle));
  if(['forecast','hourly'].includes(S.table)&&!S.offset){
    body+='<div class="chartless-forecast">'+rows.slice(0,S.table==='forecast'?14:12).map(({row,index})=>{
      let source={};try{source=JSON.parse(row.detailsJson);}catch{}
      const wind=typeof source.windSpeed==='object'?pretty(source.windSpeed):[source.windSpeed,source.windDirection].filter(Boolean).join(' ');
      return '<article class="forecast-period"><h3>'+esc(row.label||row.validFrom)+'</h3><div class="temperature">'+esc(row.value)+' <small>'+esc(row.unitCode)+'</small></div>'+
        '<p>'+esc(row.description)+'</p><p class="help">'+esc(row.validFrom)+' to '+esc(row.validUntil)+'</p>'+
        (wind?'<p>Wind: '+esc(wind)+'</p>':'')+actions(button('Original details','row',{index})+sourceButton(row,e))+'</article>';
    }).join('')+'</div>';
  }
  if(S.table==='latest')body+='<p class="help">This table uses the most recent observation inside this edition’s captured interval.</p>';
  if(S.table==='grid')body+='<p class="help">Grid rows retain each original field, value, unit and validTime interval. Source nulls remain null. Calendar durations remain literal when fixed endpoints cannot be resolved.</p>';
  if(['alerts','active-alerts'].includes(S.table))body+='<p class="help">Alert status, certainty, urgency, severity, issue and expiry information come from the retained NWS alert messages. Open a row to read its original instructions and affected zones.</p>';
  if(!rows.length)body+='<section class="empty"><h2>'+(all.length?'No displayed rows match this filter':'The captured source contains no rows for this table')+'</h2><p>Source coverage and the original response remain available below.</p></section>';
  else{
    const columns=['validFrom','validUntil','field','value','unitCode','qualityControl','label'];
    body+='<div class="table-wrap"><table class="data-table"><thead><tr>'+columns.map(c=>'<th scope="col">'+esc(c)+'</th>').join('')+'<th scope="col">Review</th></tr></thead><tbody>'+
      rows.map(({row,index})=>'<tr>'+columns.map(c=>'<td>'+esc(row[c])+'</td>').join('')+'<td>'+actions(button('Details','row',{index})+sourceButton(row,e))+'</td></tr>').join('')+'</tbody></table></div>';
  }
  body+='<div class="pagination"><span>'+esc(S.rows.total?S.rows.offset+1:0)+'–'+esc(Math.min(S.rows.offset+S.rows.rows.length,S.rows.total))+' of '+esc(S.rows.total)+' source rows'+(needle?' · '+rows.length+' match on this page':'')+'</span>'+actions(
    '<button type="button" data-op="previous-rows"'+(S.offset===0?' disabled':'')+'>Previous page</button>'+
    '<button type="button" data-op="next-rows"'+(S.offset+S.rows.rows.length>=S.rows.total?' disabled':'')+'>Next page</button>')+'</div>';
  body+='<section class="panel"><h2>Original source responses</h2>'+sourceList(e)+'</section>';
  return body;
}
function sourceButton(row,e){
  const page=e.pages.findIndex(p=>p.sha256===row.sourcePageSha256);
  return page<0?'':button('Source','source',{edition:e.id,page});
}
function sourceList(e){
  return records(['Source resource','Response identity','Coverage','Actions'],e.pages.map((p,index)=>[
    '<strong>'+esc(p.kind)+'</strong><p class="mono">'+esc(p.originalRequestUrl??p.url)+'</p>',
    '<code>'+esc(p.sha256)+'</code><p>'+bytes(p.bytes)+'</p><p class="help">'+(p.statusObserved?'HTTP '+esc(p.status):'HTTP status not supplied')+'</p>',
    esc(p.records??0)+' records<p>'+esc(p.termination??'Continued')+'</p><small>'+when(p.sourceObservedAt??p.capturedOn)+'</small>',
    actions(button('Read response','source',{edition:e.id,page:index})+button('Download response','raw-download',{edition:e.id,page:index})+
      (p.responseSha256&&p.responseSha256!==p.sha256?button('Revalidation response','raw-download',{edition:e.id,page:index,wire:'true'}):''))]));
}
function renderEditions(){
  let body=heading('Editions and changes','Review immutable source captures, open earlier versions and compare the same site.',
    button('Compare editions','form',{kind:'edition.compare'},true));
  if(!allEditions().length)return body+empty('No saved editions','Source editions appear after a capture retains one or more responses.',button('Open captures','section',{section:'captures'}));
  body+=records(['Edition','Source coverage','Capture scope','Actions'],allEditions().map(e=>[
    '<strong>'+esc(e.site.label)+'</strong><p>'+esc(e.label)+'</p><code>'+esc(short(e.id))+'</code><p class="help">Saved '+when(e.createdAt)+'</p>',
    badge(e.complete?'complete':'partial')+'<p>'+esc(e.pageCount)+' response pages · '+esc(e.summary.totalRows)+' projected rows</p>',
    '<p>'+esc(e.query.products.join(', '))+'</p><p>'+esc(e.query.units)+' · station '+esc(e.station?.id??'none')+'</p><small>'+esc(e.query.observationStart)+' to '+esc(e.query.observationEnd)+'</small>',
    actions(button(S.view.selectedEditionId===e.id?'Open selected':'Open edition','select-edition',{id:e.id})+button('Compare','form',{kind:'edition.compare',rightId:e.id}))]));
  if(S.editionOffset<S.view.editionCount)body+=actions(button('Load earlier editions','more-editions'));
  const comparison=S.comparison;
  if(comparison){
    body+='<section class="panel"><h2>Selected comparison</h2><p>'+esc(comparison.table)+' · '+esc(short(comparison.leftId))+' → '+esc(short(comparison.rightId))+'</p>'+
      metrics(Object.entries(comparison.counts).map(([name,count])=>[count,name]))+
      '<p>'+esc(comparison.meaning)+'</p>'+
      actions(button('Download complete comparison','download',{url:comparison.export.downloadUrl,name:comparison.export.name}))+
      details('Capture scope and coverage',{sourceIntervals:comparison.sourceIntervals,coverage:comparison.coverage});
    for(const kind of ['added','removed','changed']){
      body+='<h3>'+esc(kind[0].toUpperCase()+kind.slice(1))+'</h3>';
      body+=comparison[kind].length?comparison[kind].slice(0,30).map(row=>details(row.id,kind==='changed'?row.fields:row.row)).join(''):'<p class="muted">No '+esc(kind)+' rows.</p>';
      if(comparison.counts[kind]>30)body+='<p class="help">The complete comparison download contains every '+esc(kind)+' row.</p>';
    }
    if(comparison.duplicates.length)body+=details('Duplicate source record IDs',comparison.duplicates);
    body+='</section>';
  }
  const prior=S.view.exports.filter(x=>x.kind==='comparison');
  if(prior.length)body+='<section class="panel"><h2>Saved comparisons</h2>'+records(['Comparison','Saved','Actions'],prior.map(x=>[
    esc(x.table)+'<p><code>'+esc(short(x.editionId))+'</code></p>',when(x.createdAt),
    actions(button('Read comparison','open-export',{id:x.id})+button('Download','download',{url:x.downloadUrl,name:x.name}))]))+'</section>';
  return body;
}
function renderNotes(){
  let body=heading('Staff review','Keep source-specific decisions and follow-up notes with the exact edition your team reviewed.',
    button('Add review','form',{kind:'annotation.save'},true));
  if(!S.view.editionCount)return body+empty('Choose a source edition','Staff review attaches to a captured edition.',button('Open captures','section',{section:'captures'}));
  if(!S.view.annotations.length)body+=empty('Start the staff review','Record an operational decision, an alert follow-up or a data-quality question against the selected source edition.',button('Add review','form',{kind:'annotation.save'},true));
  for(const note of S.view.annotations.slice().sort((a,b)=>b.updatedAt.localeCompare(a.updatedAt))){
    const edition=allEditions().find(e=>e.id===note.editionId);
    body+='<article class="note"><header><div><h2>'+esc(note.subject)+'</h2>'+badge(note.status)+'</div>'+
      actions(button('Update review','form',{kind:'annotation.save',id:note.id})+button('Open edition','select-edition',{id:note.editionId}))+'</header>'+
      '<p>'+esc(note.note||'No additional note.')+'</p><small>'+esc(edition?.site.label??'Source edition')+' · '+esc(short(note.editionId))+' · '+when(note.updatedAt)+'</small>'+
      (note.history?.length?details('Previous saved decisions',note.history):'')+
      (note.importedFrom?details('Original imported annotation',note.importedFrom):'')+'</article>';
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
  let body=heading('Datasets and publishing','Prepare a source-backed dataset, query its native interface and operate its original publisher.',
    button('Prepare dataset','form',{kind:'dataset.prepare'},true));
  if(!S.view.editionCount)return body+empty('Capture a source edition','A dataset uses a selected edition and one of its weather tables.',button('Open captures','section',{section:'captures'}));
  body+='<h2>Prepared datasets</h2>';
  body+=records(['Dataset','Original snapshot','Source selection','Actions'],S.view.datasets.map(d=>[
    '<strong>'+esc(d.name)+'</strong><p>'+esc(d.rows)+' rows · '+esc(d.columns.length)+' columns</p>',
    '<code>'+esc(d.snapshot)+'</code><p>'+esc(d.mode)+'</p>',
    esc(d.table)+'<p><code>'+esc(short(d.editionId))+'</code></p>',
    actions(button('Query','form',{kind:'dataset.query',id:d.id})+button('Prepare release','form',{kind:'release.prepare',id:d.id})+button('Inspect dataset','dataset-detail',{id:d.id}))]));
  body+=renderQuery(S.queryResult);
  body+='<section class="panel"><h2>Original publisher runtime</h2><p>'+esc(S.schema.releaseRuntime.mode.replaceAll('_',' '))+' · selected local port '+esc(S.schema.releaseRuntime.port)+'</p>'+
    '<p class="help">The running workspace owns the publisher. Release selection, generation, runtime status and source package come from its original release store.</p></section>';
  body+='<h2>Dataset releases</h2>';
  body+=records(['Release','Selection and runtime','Original source','Actions'],S.view.releases.map(r=>{
    const generation=r.selection?.generation??r.publisher?.releases?.state?.generation??0,
      runtime=r.publisher?.releases?.runtime;
    return ['<strong>'+esc(r.id)+'</strong><p>'+esc(r.release?.publicOrigin??r.routes?.[0]?.resource??'')+'</p>',
      '<p>Generation '+esc(generation)+'</p><p>Active: '+esc(r.selection?.active??'none')+'</p>'+badge(runtime?.state??'not started')+
        (r.publisherError?'<p>'+esc(r.publisherError.message)+'</p>':''),
      '<code>'+esc(r.snapshot)+'</code><p>'+esc(r.mode)+'</p>',
      actions(button('Inspect','release-inspect',{id:r.id})+button('Activate','form',{kind:'release.activate',id:r.id})+
        button('Start','form',{kind:'release.start',id:r.id})+button('Stop','release-stop',{id:r.id})+
        button('Roll back','form',{kind:'release.rollback',id:r.id}))];
  }));
  return body;
}
function renderReceiving(){
  let body=heading('Customer handover','Receive the original customer dataset files and carry complete source editions into another workspace.',
    S.schema.inboxConfigured?button('Inspect buyer intents','form',{kind:'buyer.inspect'})+button('Receive dataset','form',{kind:'buyer.receive'},true):'');
  if(!S.schema.inboxConfigured)body+='<section class="panel"><h2>Buyer inbox</h2><p>Start this workspace with the original private inbox directory to receive its selected customer outcomes. Existing source exports remain available below.</p></section>';
  if(S.buyerResult)body+='<section class="panel"><h2>Selected original buyer intents</h2>'+records(['Intent','State and attempt','Outcome','Actions'],S.buyerResult.items.map(i=>[
    '<code>'+esc(i.intentId)+'</code>',badge(i.status)+'<p>Attempt '+esc(i.attempt??'not supplied')+'</p>',
    details('Original outcome',i.outcome),actions(button('Receive selected group','receive-selected'))]))+'</section>';
  body+='<h2>Received customer datasets</h2>';
  for(const receipt of S.view.receipts){
    body+='<section class="panel"><h3>'+esc(receipt.dataset?.name??receipt.id)+'</h3><p>'+esc(receipt.mode)+' · '+when(receipt.createdAt)+'</p>'+
      '<p>'+esc(receipt.intentIds.length)+' original inbox intents</p>'+records(['Customer file','File identity','Actions'],receipt.downloads.map(d=>[
        '<strong>'+esc(d.name)+'</strong>',bytes(d.bytes)+'<p><code>'+esc(d.sha256)+'</code></p>',
        actions(button('Download file','download',{url:d.downloadUrl,name:d.name}))]))+
      details('Original receiving selection',{id:receipt.id,intentIds:receipt.intentIds,dataset:receipt.dataset,manifestSha256:receipt.manifestSha256})+'</section>';
  }
  if(!S.view.receipts.length)body+='<p class="muted">No customer datasets have been received into this workspace.</p>';
  body+='<section class="panel"><div class="heading"><div><h2>Edition exports</h2><p>JSON, spreadsheet CSV, printable reviews and complete source packages.</p></div>'+
    actions(button('Create export','form',{kind:'export.create'},true))+'</div>'+
    records(['Export','Source selection','File identity','Actions'],S.view.exports.filter(e=>e.kind!=='comparison').slice().reverse().map(e=>[
      '<strong>'+esc(e.format)+'</strong><p>'+esc(e.name)+'</p>',esc(e.table)+'<p><code>'+esc(short(e.editionId))+'</code></p>',
      bytes(e.bytes)+'<p><code>'+esc(e.sha256)+'</code></p>',
      actions(button('Download','download',{url:e.downloadUrl,name:e.name})+button('Inspect export','export-detail',{id:e.id}))]))+'</section>';
  body+='<section class="panel"><h2>Reopen the work elsewhere</h2><p>Export a complete source package, create or select a site with the same coordinates in the receiving workspace, and import that file. The original response bodies, source observation times, capture interval and staff decisions travel with the edition.</p>'+
    actions(button('Export complete source','form',{kind:'export.create',format:'source-package'})+button('Import source package','form',{kind:'capture.import'}))+'</section>';
  return body;
}

async function loadRows(){
  const edition=selected();if(!edition)return;
  const sequence=++S.rowRequest,table=S.table,offset=S.offset;
  try{
    const result=await read(params('/api/rows',{editionId:edition.id,table,offset,limit:100}));
    if(sequence!==S.rowRequest||selected()?.id!==edition.id||S.table!==table)return;
    S.rows={...result,editionId:edition.id};
    if(S.section==='weather')render();
  }catch(error){if(sequence===S.rowRequest)notice(errorText(error));}
}
function openSourceData(title,value){
  S.source=null;$('source-title').textContent=title;$('source-meta').textContent='';
  $('source-downloads').innerHTML='';$('source-body').textContent=pretty(value);
  if(!$('source-dialog').open)$('source-dialog').showModal();
}
async function sourceEdition(id){return selected()?.id===id?selected():await read(params('/api/edition',{editionId:id}));}
async function showRaw(editionId,index){
  const e=await sourceEdition(editionId),receipt=e.pages[index];
  if(!receipt)throw new Error('Choose one of this edition’s retained source pages.');
  S.source={editionId,index,receipt};$('source-title').textContent=receipt.kind+' · original NWS response';
  $('source-meta').textContent=pretty(receipt);
  $('source-body').textContent='Reading the retained response…';
  $('source-downloads').innerHTML=button('Download original body','raw-download',{edition:editionId,page:index})+
    (receipt.responseSha256&&receipt.responseSha256!==receipt.sha256?button('Download revalidation response','raw-download',{edition:editionId,page:index,wire:'true'}):'');
  if(!$('source-dialog').open)$('source-dialog').showModal();
  const response=await request(params('/api/raw',{editionId,page:index}));
  const text=await response.text();if(S.source?.editionId===editionId&&S.source?.index===index)$('source-body').textContent=text;
}
async function downloadRaw(editionId,index,wire=false){
  const e=await sourceEdition(editionId),receipt=e.pages[index];
  if(!receipt)throw new Error('Choose a retained source page.');
  const sha=wire?receipt.responseSha256??receipt.sha256:receipt.sha256;
  await download(params('/api/raw',{editionId,page:index,wire}),receipt.kind+'-'+sha+(wire?'.response':'.json'));
}
function showRow(index){
  const row=S.rows?.rows[index];if(!row)return;
  const page=selected().pages.findIndex(p=>p.sha256===row.sourcePageSha256);
  openSourceData(row.label||row.field,row);
  $('source-meta').textContent='Source edition '+selected().id;
  $('source-downloads').innerHTML=(page>=0?button('Read original response','source',{edition:selected().id,page}):'')+
    button('Add source review','form',{kind:'annotation.save',editionId:selected().id,subject:row.field+' · '+row.recordId.slice(0,240)});
}
function latestForModal(view){
  const modal=S.modal,values=formValues($('operation-form'));
  if(modal.kind.startsWith('site.'))return {revision:view.revision,sites:values.siteId?view.sites.filter(s=>s.id===values.siteId):view.sites};
  if(modal.kind.startsWith('release.'))return {revision:view.revision,releases:values.releaseId?view.releases.filter(r=>r.id===values.releaseId):view.releases};
  if(modal.kind.startsWith('capture.'))return {revision:view.revision,sites:view.sites,
    captures:view.captures.filter(c=>!values.siteId||c.site.id===values.siteId).map(c=>({id:c.id,label:c.label,state:c.state,pageCount:c.pageCount,station:c.station,error:c.error}))};
  if(modal.kind==='annotation.save')return {revision:view.revision,annotations:view.annotations.filter(a=>a.editionId===values.editionId),selectedEditionId:view.selectedEditionId};
  return {revision:view.revision,selectedEditionId:view.selectedEditionId,editions:view.editions.map(e=>({id:e.id,site:e.site.label,complete:e.complete})),
    datasets:view.datasets.map(d=>({id:d.id,name:d.name,snapshot:d.snapshot})),operation:view.operations.find(o=>o.operationId===modal.pending?.operationId)??null};
}
async function reviewLatest(){
  if(!S.modal||S.modal.busy)return;
  try{
    const view=await read('/api/view');acceptView(view);S.modal.reviewedView=view;
    $('latest-view').textContent=pretty(latestForModal(view));$('latest-view').hidden=false;$('adopt-latest').disabled=false;
  }catch(error){$('dialog-error').textContent=errorText(error);}
}
function adoptLatest(){
  const modal=S.modal;if(!modal?.reviewedView)return;
  modal.expectedRevision=modal.reviewedView.revision;
  const generation=$('operation-form').elements.namedItem('expectedGeneration'),
    releaseId=$('operation-form').elements.namedItem('releaseId')?.value;
  if(generation&&releaseId){
    const release=modal.reviewedView.releases.find(r=>r.id===releaseId);
    generation.value=release?.selection?.generation??release?.publisher?.releases?.state?.generation??generation.value;
  }
  if(modal.pending)modal.pending.expectedRevision=modal.expectedRevision;
  $('form-revision').textContent='Reviewed workspace revision '+modal.expectedRevision+'. Your form values are retained.';
  $('dialog-error').textContent='Latest saved view reviewed. Submit the retained form to continue.';
  clearConflict();saveDialog();
}
async function moreEditions(){
  const result=await read(params('/api/editions',{offset:S.editionOffset,limit:100}));
  S.editionOffset+=result.editions.length;
  for(const e of result.editions)if(!S.editions.some(old=>old.id===e.id))S.editions.push(e);
  S.view.editionCount=result.total;render();
}
function switchSection(section){
  if(!views.has(section))return;
  S.section=section;remember('section',section);render();
  if(section==='weather')void loadRows();
}
function closeForm(){
  if(S.modal?.busy)return;
  saveDialog();$('dialog').close();S.modal=null;
  notice('Your entered form is retained in this browser session.',button('Reopen saved form','restore-form'));
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
  if(op==='restore-form'){
    const draft=saved('dialog');if(draft)openForm(draft.kind,draft.context,draft);return;
  }
  if(op==='archive-site')return runAction('site.archive',{siteId:target.dataset.id});
  if(op==='reopen-site'){
    const site=S.view.sites.find(s=>s.id===target.dataset.id);
    if(site)return runAction('site.save',{siteId:site.id,label:site.label,latitude:site.latitude,longitude:site.longitude,stationId:site.stationId,owner:site.owner,note:site.note,active:true});
    return;
  }
  if(op==='capture-pause')return runAction('capture.pause',{captureId:target.dataset.id});
  if(op==='capture-resume')return runAction('capture.resume',{captureId:target.dataset.id});
  if(op==='select-edition')return runAction('edition.select',{editionId:target.dataset.id});
  if(op==='source')return showRaw(target.dataset.edition,Number(target.dataset.page));
  if(op==='raw-download')return downloadRaw(target.dataset.edition,Number(target.dataset.page),target.dataset.wire==='true');
  if(op==='download')return download(target.dataset.url,target.dataset.name);
  if(op==='row')return showRow(Number(target.dataset.index));
  if(op==='load-rows')return loadRows();
  if(op==='previous-rows'){S.offset=Math.max(0,S.offset-100);return loadRows();}
  if(op==='next-rows'){S.offset+=100;return loadRows();}
  if(op==='more-editions')return moreEditions();
  if((op==='query-next'||op==='query-first')&&S.querySelection){
    const query=new URLSearchParams(S.querySelection.query);query.delete('cursor');
    if(op==='query-next'&&S.queryResult?.page?.nextCursor)query.set('cursor',S.queryResult.page.nextCursor);
    return runAction('dataset.query',{datasetId:S.querySelection.datasetId,query:query.toString()});
  }
  if(op==='dataset-detail')return openSourceData('Original prepared dataset',S.view.datasets.find(d=>d.id===target.dataset.id));
  if(op==='export-detail')return openSourceData('Saved edition export',S.view.exports.find(e=>e.id===target.dataset.id));
  if(op==='release-inspect')return runAction('release.inspect',{releaseId:target.dataset.id});
  if(op==='release-stop')return runAction('release.stop',{releaseId:target.dataset.id});
  if(op==='receive-selected')return openForm('buyer.receive',{intentIds:S.buyerResult.intentIds});
  if(op==='retry-action'&&S.pending)return runAction(S.pending.action,S.pending.payload,S.pending);
  if(op==='inspect-pending'){
    const pending=S.pending;if(!pending)return;
    const payload={...pending.payload};if(payload.bundle)payload.bundle={schema:payload.bundle.schema,site:payload.bundle.site,sourcePages:(payload.bundle.pages??payload.bundle.responses??[]).length};
    return openSourceData('Saved workspace action',{...pending,payload,operation:S.view.operations.find(o=>o.operationId===pending.operationId)??null});
  }
  if(op==='open-export'){
    const item=S.view.exports.find(e=>e.id===target.dataset.id);if(!item)return;
    const result=await read(item.downloadUrl);
    if(item.kind==='comparison'){S.comparison={...result,export:item};switchSection('editions');}
    else openSourceData(item.name,result);
  }
}
document.addEventListener('click',event=>{
  const target=event.target.closest('button[data-op]');if(!target||target.disabled)return;
  event.preventDefault();void operate(target).catch(error=>notice(errorText(error)));
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
  if(event.target.id==='f-weather-table'){S.table=event.target.value;S.offset=0;S.rows=null;remember('table',S.table);render();void loadRows();}
});
let filterTimer;
document.addEventListener('input',event=>{
  if(!['f-weather-filter','f-site-filter'].includes(event.target.id))return;
  const id=event.target.id,position=event.target.selectionStart;
  if(id==='f-weather-filter'){S.weatherFilter=event.target.value;remember('weatherFilter',S.weatherFilter);}
  else{S.siteFilter=event.target.value;remember('siteFilter',S.siteFilter);}
  clearTimeout(filterTimer);filterTimer=setTimeout(()=>{render();const input=$(id);if(input){input.focus();input.setSelectionRange(position,position);}},180);
});
async function begin(){
  if(!token){notice('Reopen the private NWS session URL printed by the workspace command.');return;}
  try{
    S.schema=await read('/api/schema');if(!S.schema.tables.some(t=>t.id===S.table))S.table='forecast';
    await refresh({quiet:true});
    const draft=saved('dialog');
    if(S.pending)notifyPending();
    else if(draft)notice('A previously entered form is retained in this browser session.',button('Reopen saved form','restore-form'));
    setInterval(()=>{if(!document.hidden&&S.view?.captures.some(c=>['RUNNING','QUEUED'].includes(c.state)))void refresh({quiet:true});},4000);
  }catch(error){notice(errorText(error));}
}
void begin();
