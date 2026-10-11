/* MIT. Industrial customer UI. Native operations and retention remain server-owned. */
'use strict';
const $=id=>document.getElementById(id);
const token=location.hash.slice(1)||sessionStorage.getItem('valyu-workspace-token')||'';
if(location.hash){sessionStorage.setItem('valyu-workspace-token',token);history.replaceState(null,'',location.pathname);}
const state={tab:'queries',queryOffset:0,editionOffset:0,query:null,capture:null,queries:[],busy:0};
const coreKeys=new Set(['query','search_type','max_num_results','max_price','response_length','included_sources','excluded_sources','start_date','end_date']);
function node(tag,text,props={}){
  const e=document.createElement(tag);if(text!==undefined&&text!==null)e.textContent=String(text);
  for(const[k,v]of Object.entries(props)){if(k==='class')e.className=v;else e.setAttribute(k,v);}return e;
}
function status(text,error=false){$('status').textContent=text;$('status').dataset.error=String(error);}
function pretty(value){return JSON.stringify(value,null,2);}
function empty(message){return node('div',message,{class:'empty'});}
function button(text,action,primary=false){
  const b=node('button',text,{type:'button',...(primary?{class:'primary'}:{})});
  b.addEventListener('click',()=>run(action));return b;
}
function details(title,value){
  const e=node('details'),s=node('summary',title),p=node('pre',typeof value==='string'?value:pretty(value));
  e.append(s,p);return e;
}
async function api(path,data){
  const response=await fetch(path,{method:data===undefined?'GET':'POST',
    headers:{'x-workspace-token':token,...(data===undefined?{}:{'content-type':'application/json'})},
    ...(data===undefined?{}:{body:JSON.stringify(data)})});
  const result=await response.json();if(!response.ok)throw new Error(result.error||'Request failed');return result;
}
async function run(action){
  state.busy++;try{const result=await action();return result;}
  catch(error){status(error.message||'Request failed',true);}
  finally{state.busy--;}
}
async function download(path,filename){
  const response=await fetch(path,{headers:{'x-workspace-token':token}});
  if(!response.ok){const error=await response.json();throw new Error(error.error);}
  const url=URL.createObjectURL(await response.blob()),a=node('a',null,{href:url,download:filename});
  document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),2000);
}
function tab(name){
  state.tab=name;for(const section of document.querySelectorAll('.tab'))section.hidden=section.id!==name;
  for(const b of document.querySelectorAll('nav button'))b.classList.toggle('active',b.dataset.tab===name);
  if(name==='editions')return refreshEditions();
}
function syncResponseLength(){
  const custom=$('response-length').value==='custom',input=$('response-length-custom');
  $('response-length-custom-label').hidden=!custom;input.disabled=!custom;input.required=custom;
}
function resetForm(){
  state.query=null;state.capture=null;$('query-form').reset();syncResponseLength();$('extra-options').value='{}';
  $('form-title').textContent='New research query';$('edit-state').textContent='Draft';
  $('query-form').hidden=false;$('query-detail').hidden=true;renderQueryList();$('title').focus();
}
function setForm(query){
  const input=query.input;
  $('title').value=query.title;$('question').value=input.query??'';$('search-type').value=input.search_type??'all';
  $('max-results').value=input.max_num_results??5;$('max-price').value=input.max_price??'';
  const customLength=typeof input.response_length==='number';
  $('response-length').value=customLength?'custom':(input.response_length??'short');
  $('response-length-custom').value=customLength?String(input.response_length):'';syncResponseLength();
  $('include-sources').value=(input.included_sources??[]).join('\n');$('exclude-sources').value=(input.excluded_sources??[]).join('\n');
  $('start-date').value=input.start_date??'';$('end-date').value=input.end_date??'';
  $('extra-options').value=pretty(Object.fromEntries(Object.entries(input).filter(([key])=>!coreKeys.has(key))));
  $('form-title').textContent='Edit draft query';$('edit-state').textContent='Revision '+query.revision;
}
function formInput(){
  const extra=JSON.parse($('extra-options').value||'{}');
  if(!extra||typeof extra!=='object'||Array.isArray(extra))throw new Error('Additional options must be a JSON object.');
  if(Object.hasOwn(extra,'response_length'))throw new Error('Set response length with the Response length control above.');
  let responseLength=$('response-length').value;
  if(responseLength==='custom'){
    responseLength=Number($('response-length-custom').value);
    if(!Number.isSafeInteger(responseLength)||responseLength<=0)
      throw new Error('Custom response length must be a positive whole number of characters.');
  }
  const input={...extra,query:$('question').value.trim(),search_type:$('search-type').value,
    max_num_results:Number($('max-results').value),response_length:responseLength};
  if($('max-price').value!=='')input.max_price=Number($('max-price').value);
  const includes=$('include-sources').value.split('\n').map(s=>s.trim()).filter(Boolean),
    excludes=$('exclude-sources').value.split('\n').map(s=>s.trim()).filter(Boolean);
  if(includes.length)input.included_sources=includes;if(excludes.length)input.excluded_sources=excludes;
  if($('start-date').value)input.start_date=$('start-date').value;if($('end-date').value)input.end_date=$('end-date').value;
  return input;
}
function renderQueryList(){
  const list=$('query-list');list.replaceChildren();
  if(!state.queries.length)list.append(empty('Save a query to begin.'));
  for(const q of state.queries){
    const b=node('button',null,{type:'button',class:'query-row'+(state.query?.id===q.id?' active':'')});
    b.append(node('strong',q.title),node('span',q.phase+' · '+new Date(q.createdAt).toLocaleString(),{class:'muted'}));
    b.addEventListener('click',()=>run(()=>openQuery(q.id)));list.append(b);
  }
}
async function refreshQueries(){
  const result=await api('/api/state?offset='+state.queryOffset);
  state.queries=result.queries;state.policy=result.provider;
  renderQueryList();$('queries-page').textContent=result.total?String(result.offset+1)+'–'+String(Math.min(result.total,result.offset+result.queries.length))+' of '+result.total:'0 queries';
  $('queries-prev').disabled=state.queryOffset===0;$('queries-next').disabled=state.queryOffset+30>=result.total;
  $('max-results').max=String(result.provider.limits?.maxNumResults??20);
  status('Workspace ready · '+result.total+' saved queries · '+(result.paymentConfigured?'native buyer configured':'research mode'));
}
function metric(label,value){const e=node('div',null,{class:'metric'});e.append(node('strong',value??'—'),node('span',label));return e;}
function summarize(view){
  const metrics=node('div',null,{class:'metrics'}),s=view.summary??{},p=view.raw?.provider??{},usage=p.usage??s.usage??{};
  metrics.append(metric('Returned occurrences',view.rows?.length??0),
    metric('Provider deduction (USD)',usage.totalDeductionDollars??s.totalDeductionDollars??s.total_deduction_dollars),
    metric('Retained source results',view.delivery?.retainedResultCount??view.rows?.filter(r=>r.contentDisposition==='durable').length??0),
    metric('Reference handles',view.delivery?.withheldResultCount??view.rows?.filter(r=>r.contentDisposition==='withheld').length??0));
  return metrics;
}
function renderRows(container,view,{captureId,editable=false}={}){
  const rows=view.rows??[],filter=node('input',null,{type:'search',placeholder:'Filter titles, sources or occurrence handles','aria-label':'Filter research results'});
  const wrapper=node('div');
  function draw(){
    wrapper.replaceChildren();const term=filter.value.toLowerCase();
    const shown=rows.filter(r=>[r.id,r.title,r.source,r.url].some(v=>String(v??'').toLowerCase().includes(term)));
    if(!shown.length)wrapper.append(empty(rows.length?'No matching results.':'This delivery has no result rows.'));
    for(const row of shown){
      const item=node('article',null,{class:'result'});
      const allowed=row.contentDisposition==='durable',title=row.title||('Source occurrence '+String(row.id??row.occurrenceId));
      item.append(node('h3',title),node('span',allowed?'Retained under source agreement':'Reference handle',{class:'badge'}));
      item.append(node('p',row.id??row.occurrenceId,{class:'result-meta code'}));
      if(row.source)item.append(node('p','Source: '+row.source,{class:'result-meta'}));
      if(row.safeUrl){try{const u=new URL(row.safeUrl);if(['https:','http:'].includes(u.protocol))item.append(node('a',row.url||u.href,{href:u.href,target:'_blank',rel:'noopener noreferrer'}));}catch{}}
      if(allowed){
        item.append(node('div',row.contentText??pretty(row.raw?.content??row.content??''),{class:'result-content'}));
        if(row.citations&&Object.keys(row.citations).length)item.append(details('Citations and references',row.citations));
        item.append(details('Original source fields',row.raw));
      }else item.append(node('p','The source delivery retains this occurrence handle. Its content remains with the provider.',{class:'muted'}));
      const annotation=view.annotations?.[row.id]??{revision:0,selected:false,note:'',tags:[]};
      if(editable){
        const grid=node('div',null,{class:'note-grid'}),selection=node('label',null,{class:'check'}),check=node('input',null,{type:'checkbox'});
        check.checked=annotation.selected;selection.append(check,document.createTextNode('Selected'));
        const notesLabel=node('label','Your research note'),notes=node('textarea',null,{rows:'3',maxlength:'16000'});
        notes.value=annotation.note;notesLabel.append(notes);grid.append(selection,notesLabel);item.append(grid);
        const tagsLabel=node('label','Tags (comma separated)'),tags=node('input');tags.value=annotation.tags.join(', ');tagsLabel.append(tags);item.append(tagsLabel);
        item.append(button('Save note',async()=>{
          await api('/api/annotations',{captureId,rowId:row.id,expectedRevision:annotation.revision,selected:check.checked,note:notes.value,
            tags:tags.value.split(',').map(s=>s.trim()).filter(Boolean)});
          await openQuery(state.query.id);status('Research note saved.');
        }));
      }else if(annotation.selected||annotation.note||annotation.tags?.length){
        item.append(node('p',annotation.selected?'Selected for research':'Research note',{class:'badge'}));
        if(annotation.note)item.append(node('p',annotation.note));
        if(annotation.tags?.length)item.append(node('p',annotation.tags.join(' · '),{class:'muted'}));
      }
      wrapper.append(item);
    }
  }
  filter.addEventListener('input',draw);container.append(filter,wrapper);draw();
}
async function openQuery(id){
  const detail=await api('/api/queries/'+id);state.query=detail.query;state.capture=detail.capture;
  renderQueryList();$('query-form').hidden=detail.query.phase!=='DRAFT';if(detail.query.phase==='DRAFT')setForm(detail.query);
  const main=$('query-detail');main.hidden=false;main.replaceChildren();
  const panel=node('div',null,{class:'panel'}),heading=node('div',null,{class:'section-title'});
  heading.append(node('h2',detail.query.title),node('span',detail.query.phase,{class:'badge'}));panel.append(heading);
  panel.append(node('p',detail.query.id,{class:'muted code'}),details('Exact saved request',detail.query.input));
  const actions=node('div',null,{class:'actions'});
  actions.append(button('New edition from this query',async()=>{const q=await api('/api/queries/'+id+'/duplicate',{});await refreshQueries();await openQuery(q.id);}));
  if(['DRAFT','PREPARING'].includes(detail.query.phase)){
    const grid=node('div',null,{class:'form-grid'}),capLabel=node('label','Buyer total cap (atomic units)'),cap=node('input',null,{inputmode:'numeric',pattern:'[0-9]+',placeholder:'Explicit maximum payment'}),
      acceptLabel=node('label','Payment option index'),accept=node('input',null,{type:'number',min:'0',value:'0'});
    cap.value=detail.query.prepared?.maxAtomic??'';accept.value=detail.query.prepared?.acceptIndex??0;capLabel.append(cap);acceptLabel.append(accept);grid.append(capLabel,acceptLabel);panel.append(grid);
    panel.append(node('p','The provider CPM allowance controls source selection. This buyer cap limits the total native payment for the request.',{class:'muted'}));
    actions.append(button('Prepare native review',async()=>{
      status('Preparing the saved request with the original buyer…');
      await api('/api/queries/'+id+'/prepare',{expectedRevision:detail.query.revision,maxAtomic:cap.value,acceptIndex:Number(accept.value)});
      await refreshQueries();await openQuery(id);status('Native review prepared.');
    },true));
  }
  if(detail.query.prepared?.review){
    panel.append(details('Native payment and request review',detail.query.prepared.review));
    actions.append(button('Inspect operation',async()=>{const value=await api('/api/queries/'+id+'/inspect');panel.append(details('Current native operation',value.native));status('Original operation inspected.');}));
    actions.append(button('Recover saved result',async()=>{status('Recovering the original operation…');await api('/api/queries/'+id+'/collect',{});await refreshQueries();await openQuery(id);}));
    if(!detail.capture)actions.append(button('Execute reviewed request',async()=>{status('The original native operator is executing this reviewed request…');await api('/api/queries/'+id+'/execute',{});await refreshQueries();await openQuery(id);},true));
  }
  panel.append(actions);main.append(panel);
  if(detail.capture){
    const results=node('section',null,{class:'panel'}),head=node('div',null,{class:'section-title'});
    head.append(node('h2','Source delivery'),node('span',detail.capture.status??'Captured',{class:'badge'}));results.append(head,summarize(detail.capture));
    results.append(details('Source and native operation information',{sha256:detail.capture.sha256,bytes:detail.capture.bytes,
      provider:detail.capture.raw?.provider,delivery:detail.capture.delivery,provenance:detail.capture.provenance}));
    const toolbar=node('div',null,{class:'actions'});
    toolbar.append(button('Freeze research edition',async()=>{
      const e=await api('/api/captures/'+detail.capture.id+'/freeze',{expectedSelectionSha256:detail.capture.selectionSha256,title:detail.query.title});
      $('compare-right').value=e.id;await tab('editions');await openEdition(e.id);status('Research edition saved.');
    },true));
    toolbar.append(button('Download source delivery',()=>download('/api/captures/'+detail.capture.id+'/body','valyu-delivery-'+detail.capture.id+'.json')));
    results.append(toolbar);renderRows(results,detail.capture,{captureId:detail.capture.id,editable:true});main.append(results);
  }
}
async function refreshEditions(){
  const result=await api('/api/editions?offset='+state.editionOffset),container=$('edition-list');container.replaceChildren();
  if(!result.editions.length)container.append(empty('Freeze a query result or import a research edition.'));
  else{
    const table=node('table'),head=node('tr');for(const title of ['Title','Created','Edition','Actions'])head.append(node('th',title));
    const thead=node('thead');thead.append(head);table.append(thead);const tbody=node('tbody');
    for(const e of result.editions){
      const tr=node('tr'),actions=node('td'),buttons=node('div',null,{class:'small-actions'});
      buttons.append(button('Open',()=>openEdition(e.id)),button('Compare as earlier',()=>{$('compare-left').value=e.id;return tab('compare');}),
        button('Compare as later',()=>{$('compare-right').value=e.id;return tab('compare');}));
      actions.append(buttons);tr.append(node('td',e.title),node('td',new Date(e.createdAt).toLocaleString()),
        node('td',e.id,{class:'code'}),actions);tbody.append(tr);
    }
    table.append(tbody);const wrap=node('div',null,{class:'table-wrap'});wrap.append(table);container.append(wrap);
  }
  $('editions-page').textContent=result.total?String(result.offset+1)+'–'+Math.min(result.total,result.offset+result.editions.length)+' of '+result.total:'0 editions';
  $('editions-prev').disabled=state.editionOffset===0;$('editions-next').disabled=state.editionOffset+30>=result.total;
}
async function openEdition(id){
  const edition=await api('/api/editions/'+id),container=$('edition-detail');container.replaceChildren();
  const panel=node('section',null,{class:'panel'}),heading=node('div',null,{class:'section-title'});
  heading.append(node('h2',edition.title),node('span',edition.retentionMode??'Research edition',{class:'badge'}));
  panel.append(heading,node('p',id,{class:'muted code'}),summarize(edition));
  const actions=node('div',null,{class:'actions'});
  for(const format of ['html','md','csv','json'])actions.append(button('Export '+format.toUpperCase(),()=>download('/api/editions/'+id+'/export?format='+format,'valyu-edition-'+id+'.'+format)));
  panel.append(actions,details('Request and source agreement',{query:edition.query,response:edition.response,
    retentionMode:edition.retentionMode,validUntil:edition.validUntil,agreementReference:edition.agreementReference}));
  renderRows(panel,edition);container.append(panel);
}
function renderComparison(value){
  const container=$('comparison');container.replaceChildren();const panel=node('section',null,{class:'panel'}),c=value.comparison;
  panel.append(node('h2','Edition comparison'),details('Compared source editions',{left:value.left,right:value.right}),details('Usage and source summary',c.summary));
  for(const[key,label]of [['added','Added results'],['removed','Removed results'],['changed','Changed results']]){
    const items=c[key]??[];panel.append(node('h3',label+' ('+items.length+')'));
    if(!items.length)panel.append(node('p','None',{class:'muted'}));
    else for(const item of items)panel.append(details(item.title??item.id??item.occurrenceId??label,item));
  }
  container.append(panel);
}
$('response-length').addEventListener('change',syncResponseLength);
$('query-form').addEventListener('submit',event=>{event.preventDefault();run(async()=>{
  const q=await api('/api/queries',{...(state.query?.phase==='DRAFT'?{id:state.query.id,expectedRevision:state.query.revision}:{}),
    title:$('title').value,input:formInput()});await refreshQueries();await openQuery(q.id);status('Query saved. Review its exact request before preparing payment.');
});});
$('compare-form').addEventListener('submit',event=>{event.preventDefault();run(async()=>renderComparison(await api('/api/compare',{left:$('compare-left').value.trim(),right:$('compare-right').value.trim(),editions:true})));});
$('import-edition').addEventListener('change',()=>run(async()=>{
  const file=$('import-edition').files[0];if(!file)return;if(file.size>40*1024*1024)throw new Error('Edition file exceeds 40 MiB.');
  const result=await api('/api/import-edition',JSON.parse(await file.text()));$('import-edition').value='';
  await refreshEditions();await openEdition(result.id);status('Research edition reopened.');
}));
for(const b of document.querySelectorAll('nav button'))b.addEventListener('click',()=>run(()=>tab(b.dataset.tab)));
$('new-query').addEventListener('click',resetForm);$('reset-query').addEventListener('click',resetForm);
$('refresh').addEventListener('click',()=>run(async()=>{await refreshQueries();if(state.tab==='editions')await refreshEditions();if(state.query)await openQuery(state.query.id);}));
for(const[type,field,refresh]of [['queries','queryOffset',refreshQueries],['editions','editionOffset',refreshEditions]]){
  $(type+'-prev').addEventListener('click',()=>run(async()=>{state[field]=Math.max(0,state[field]-30);await refresh();}));
  $(type+'-next').addEventListener('click',()=>run(async()=>{state[field]+=30;await refresh();}));
}
syncResponseLength();run(refreshQueries);
