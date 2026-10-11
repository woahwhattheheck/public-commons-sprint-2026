'use strict';
const $=id=>document.getElementById(id);
const token=location.hash.slice(1)||sessionStorage.getItem('firecrawl-research-token');
if(token){sessionStorage.setItem('firecrawl-research-token',token);history.replaceState(null,'',location.pathname);}
const state={query:null,detail:null,collection:null,workspace:null,offset:0,group:'all',row:null,captures:new Map(),captureOffset:0,captureTotal:0};
const el=(name,text,className)=>{const e=document.createElement(name);if(text!==undefined)e.textContent=text;if(className)e.className=className;return e;};
function notice(text){$('notice').textContent=text;}
async function api(path,body,raw=false){
  const response=await fetch('/api/'+path,{method:body===undefined?'GET':'POST',
    headers:{'x-workspace-token':token??'',...(body===undefined?{}:{'content-type':'application/json'})},
    ...(body===undefined?{}:{body:JSON.stringify(body)})});
  if(!response.ok){let value;try{value=await response.json();}catch{}throw new Error(value?.error??'REQUEST_FAILED_'+response.status);}
  return raw?response:response.json();
}
async function action(task,message){
  try{const value=await task();if(message)notice(message);return value;}catch(error){notice(error.message);return null;}
}
function operationFields(){
  const read=$('operation').value==='firecrawl-read';
  $('search-inputs').hidden=read;$('read-input').hidden=!read;$('limit-label').hidden=read;
}
function reset(){
  state.query=null;state.detail=null;state.row=null;$('query-form').reset();$('query-form').querySelectorAll('input,select,textarea').forEach(e=>e.disabled=false);
  $('editor-title').textContent='New research request';$('phase').textContent='DRAFT';$('purchase').hidden=true;
  $('results').hidden=true;$('duplicate').hidden=true;$('save-query').hidden=false;$('collection-panel').hidden=true;
  operationFields();renderLists();
}
function inputValue(){
  if($('operation').value==='firecrawl-read')return {url:$('url').value};
  const value={query:$('query').value,limit:Number($('limit').value),
    sources:['web','news','images'].filter(name=>$(name).checked),highlights:$('highlights').checked};
  const filter=$('domain-mode').value;
  if(filter)value[filter]=$('domains').value.split(/\r?\n/).map(x=>x.trim()).filter(Boolean);
  for(const name of ['location','country','tbs'])if($(name).value)value[name]=$(name).value;
  return value;
}
function renderLists(){
  $('queries').replaceChildren();
  for(const q of state.workspace.queries){
    const button=el('button',q.title,'item'+(q.id===state.query?.id?' active':''));
    button.append(el('small',q.operation.replace('firecrawl-','')+' · '+q.phase));button.onclick=()=>action(()=>loadQuery(q.id));
    $('queries').append(button);
  }
  $('collections').replaceChildren();
  for(const c of state.workspace.collections){
    const button=el('button',c.title,'item'+(c.id===state.collection?.id?' active':''));
    button.append(el('small','Revision '+c.revision));button.onclick=()=>action(()=>loadCollection(c.id));$('collections').append(button);
  }
  $('counts').textContent=state.workspace.total+' retained requests';
  $('page').textContent=state.workspace.total?(state.offset+1)+'–'+Math.min(state.offset+30,state.workspace.total):'0';
  $('previous').disabled=state.offset===0;$('next').disabled=state.offset+30>=state.workspace.total;
}
async function refresh(){
  state.workspace=await api('state?offset='+state.offset);renderLists();
  $('limit').max=state.workspace.policy.maxResultsPerSource;
  const p=state.workspace.policy;
  $('policy').textContent='Up to '+p.maxResultsPerSource+' results per source, '+p.maxSources+' sources. Page content is retained as Markdown and links. The complete response is limited to '+Math.round(p.maxResponseBytes/1024)+' KiB.';
}
async function loadQuery(id){
  const detail=await api('queries/'+id);state.query=detail.query;state.detail=detail;state.row=null;state.group='all';
  const q=detail.query,input=q.input;
  $('title').value=q.title;$('operation').value=q.operation;$('query').value=input.query??'';$('url').value=input.url??'';
  $('limit').value=input.limit??3;
  for(const name of ['web','news','images'])$(name).checked=(input.sources??['web']).includes(name);
  for(const name of ['location','country','tbs'])$(name).value=input[name]??'';
  $('highlights').checked=input.highlights!==false;
  $('domain-mode').value=input.includeDomains?'includeDomains':input.excludeDomains?'excludeDomains':'';
  $('domains').value=(input.includeDomains??input.excludeDomains??[]).join('\n');
  $('query-form').querySelectorAll('input,select,textarea').forEach(e=>e.disabled=q.phase!=='DRAFT');
  $('editor-title').textContent=q.title;$('phase').textContent=q.phase;
  $('save-query').hidden=q.phase!=='DRAFT';$('duplicate').hidden=false;
  $('purchase').hidden=false;$('prepare').disabled=!state.workspace.paymentConfigured||!['DRAFT','PREPARING'].includes(q.phase);
  $('collect').disabled=!q.prepared?.review;$('inspect').disabled=!q.prepared?.review;
  $('purchase-summary').textContent=state.workspace.paymentConfigured?
    'Prepare the exact request against the installed merchant client and your existing operator profile. Execution uses the original buyer terminal.':
    'This workspace can review retained provider observations. Configure the original merchant client and operator profile to prepare a purchase.';
  $('review').textContent=q.prepared?JSON.stringify(q.prepared,null,2):'No buyer request prepared.';
  $('execute-help').textContent=q.prepared?.review?
    'Execute this saved query from the workspace CLI using query ID '+q.id+'. Then use Read retained result to inspect the original outcome.':'';
  $('results').hidden=!detail.capture;
  if(detail.capture){
    const capture=detail.capture;$('capture-kind').textContent=capture.kind.replaceAll('_',' ');
    $('capture-summary').textContent=capture.counts.web+' web · '+capture.counts.news+' news · '+capture.counts.images+' images · '+capture.created+
      (capture.creditsUsed!==null?' · Provider credits: '+capture.creditsUsed:'');
    $('provider-warning').textContent=capture.warning??'';$('provider-warning').hidden=!capture.warning;renderResults();
  }
  operationFields();renderLists();
}
function renderResults(){
  const capture=state.detail.capture;$('result-list').replaceChildren();
  const rows=capture.rows.filter(r=>state.group==='all'||r.group===state.group);
  for(const row of rows){
    const note=capture.annotations[row.id],button=el('button',undefined,'result'+(row.id===state.row?' active':''));
    button.append(el('small',(note?.selected?'Selected · ':'')+row.group),el('strong',row.title),el('p',String(row.description).slice(0,220)));
    button.onclick=()=>showResult(row.id);$('result-list').append(button);
  }
  if(!rows.length)$('result-list').append(el('p','No results in this group.'));
  if(state.row&&rows.some(r=>r.id===state.row))showResult(state.row);
  else if(rows.length)showResult(rows[0].id);
  else $('result-detail').replaceChildren(el('p','No retained source selected.'));
}
function anchor(url,label){
  try{const u=new URL(url);if(!['http:','https:'].includes(u.protocol)||u.username||u.password)return el('span',label??url);
    const a=el('a',label??url);a.href=u.href;a.target='_blank';a.rel='noopener noreferrer';return a;
  }catch{return el('span',label??url??'No source URL');}
}
function showResult(id){
  state.row=id;
  const capture=state.detail.capture,row=capture.rows.find(r=>r.id===id),note=capture.annotations[id]??{revision:0,selected:false,note:'',tags:[]};
  const panel=$('result-detail');panel.replaceChildren(el('h3',row.title),anchor(row.url),el('p',row.description));
  if(row.date)panel.append(el('p',row.date,'meta'));
  if(row.imageUrl)panel.append(el('p','Image source: '),anchor(row.imageUrl));
  const selected=el('input');selected.type='checkbox';selected.checked=note.selected;
  const selection=el('label',undefined,'check');selection.append(selected,document.createTextNode('Select this source for the collection'));
  const notes=el('textarea');notes.value=note.note;notes.rows=4;notes.maxLength=16000;
  const noteLabel=el('label','Research notes');noteLabel.append(notes);
  const tags=el('input');tags.value=note.tags.join(', ');const tagsLabel=el('label','Tags, separated by commas');tagsLabel.append(tags);
  const save=el('button','Save source review');save.onclick=()=>action(async()=>{
    const result=await api('annotations',{captureId:capture.id,rowId:id,expectedRevision:note.revision,selected:selected.checked,note:notes.value,
      tags:tags.value.split(',').map(x=>x.trim()).filter(Boolean)});
    capture.annotations[id]=result;renderResults();
  },'Source selection and notes saved.');
  panel.append(selection,noteLabel,tagsLabel,save);
  if(row.group!=='images'&&row.url){
    const read=el('button','Prepare a new read request');
    read.onclick=()=>{const url=row.url,title='Read: '+row.title;reset();$('operation').value='firecrawl-read';$('url').value=url;$('title').value=title.slice(0,200);operationFields();notice('New page request prepared for review; save it to continue.');};
    panel.append(document.createTextNode(' '),read);
  }
  if(typeof row.original.markdown==='string'){
    const details=el('details'),summary=el('summary','Retained Markdown'),text=el('pre',row.original.markdown);details.append(summary,text);panel.append(details);
  }
  const metadata=el('details'),summary=el('summary','Original result and response identity');
  metadata.append(summary,el('pre',JSON.stringify({responseSha256:capture.sha,contentSha256:row.contentSha256,original:row.original},null,2)));panel.append(metadata);
}
async function loadCaptures(resetList=false){
  if(resetList){state.captures.clear();state.captureOffset=0;}
  const page=await api('captures?offset='+state.captureOffset);
  for(const row of page.rows)state.captures.set(row.id,row);
  state.captureOffset+=page.rows.length;state.captureTotal=page.total;
  $('load-captures').disabled=state.captureOffset>=page.total;
  renderCaptureSelections();
}
function renderCaptureSelections(){
  const saved=new Set(state.collection?.captureIds??[]);
  for(const e of $('collection-members').querySelectorAll('input')){if(e.checked)saved.add(e.value);else saved.delete(e.value);}
  $('collection-members').replaceChildren();
  for(const capture of state.captures.values()){
    const input=el('input');input.type='checkbox';input.value=capture.id;input.checked=saved.has(capture.id);
    const label=el('label',undefined,'check');label.append(input,document.createTextNode(capture.title+' · '+capture.created));$('collection-members').append(label);
  }
  for(const key of ['compare-left','compare-right']){
    const old=$(key).value;$(key).replaceChildren(el('option','Select a retained response'));
    $(key).firstChild.value='';
    for(const capture of state.captures.values()){const option=el('option',capture.title+' · '+capture.created);option.value=capture.id;$(key).append(option);}
    $(key).value=old;
  }
}
async function loadCollection(id){
  state.collection=await api('collections/'+id);const c=state.collection;
  $('collection-panel').hidden=false;$('collection-title').value=c.title;$('collection-description').value=c.description;
  $('collection-revision').textContent='Revision '+c.revision;$('freeze').disabled=false;
  $('collection-members').replaceChildren();renderCaptureSelections();renderEditions();renderLists();
  $('collection-panel').scrollIntoView({block:'start',behavior:'smooth'});
}
function renderEditions(){
  $('editions').replaceChildren();
  for(const edition of state.collection?.editions??[]){
    const item=el('div',undefined,'edition');item.append(el('strong','Revision '+edition.collection_revision+' · '+edition.created),el('p',edition.sha,'meta'));
    const buttons=el('div',undefined,'actions');
    for(const format of ['html','csv','json']){
      const button=el('button','Download '+format.toUpperCase());
      button.onclick=()=>action(async()=>{const response=await api('editions/'+edition.id+'?format='+format,undefined,true),blob=await response.blob(),url=URL.createObjectURL(blob);
        const a=el('a');a.href=url;a.download='research-'+edition.id+'.'+format;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
      },'Frozen edition downloaded.');buttons.append(button);
    }
    item.append(buttons);$('editions').append(item);
  }
}
$('operation').onchange=operationFields;$('new-query').onclick=reset;
$('query-form').onsubmit=event=>{event.preventDefault();action(async()=>{
  const q=await api('queries',{...(state.query?{id:state.query.id,expectedRevision:state.query.revision}:{}),
    title:$('title').value,operation:$('operation').value,input:inputValue()});
  await refresh();await loadQuery(q.id);
},'Research request saved.');};
$('duplicate').onclick=()=>{const q=state.query;reset();$('title').value=q.title+' (new request)';$('operation').value=q.operation;
  const input=q.input;$('query').value=input.query??'';$('url').value=input.url??'';$('limit').value=input.limit??3;
  for(const name of ['web','news','images'])$(name).checked=(input.sources??['web']).includes(name);
  for(const name of ['location','country','tbs'])$(name).value=input[name]??'';$('highlights').checked=input.highlights!==false;
  $('domain-mode').value=input.includeDomains?'includeDomains':input.excludeDomains?'excludeDomains':'';
  $('domains').value=(input.includeDomains??input.excludeDomains??[]).join('\n');operationFields();};
$('prepare').onclick=()=>action(async()=>{const q=state.query;await api('queries/'+q.id+'/prepare',{expectedRevision:q.revision,maxAtomic:$('max-atomic').value,acceptIndex:Number($('accept').value)});await refresh();await loadQuery(q.id);},'Original buyer request prepared. The saved operation keeps its stable identity.');
$('collect').onclick=()=>action(async()=>{const id=state.query.id,result=await api('queries/'+id+'/collect',{});await refresh();await loadQuery(id);await loadCaptures(true);notice(result.capture?'Original saved response is available.':'No complete saved response is available; inspect the same original operation.');});
$('inspect').onclick=()=>action(async()=>{$('review').textContent=JSON.stringify(await api('queries/'+state.query.id+'/inspect'),null,2);},'Original operation inspected.');
for(const button of document.querySelectorAll('[data-group]'))button.onclick=()=>{state.group=button.dataset.group;state.row=null;renderResults();};
$('refresh').onclick=()=>action(async()=>{await refresh();if(state.query)await loadQuery(state.query.id);await loadCaptures(true);},'Saved work refreshed.');
$('previous').onclick=()=>action(async()=>{state.offset=Math.max(0,state.offset-30);await refresh();});
$('next').onclick=()=>action(async()=>{state.offset+=30;await refresh();});
$('new-collection').onclick=()=>{state.collection=null;$('collection-title').value='';$('collection-description').value='';$('collection-revision').textContent='New collection';$('collection-panel').hidden=false;$('freeze').disabled=true;$('collection-members').replaceChildren();renderCaptureSelections();renderEditions();};
$('load-captures').onclick=()=>action(()=>loadCaptures());
$('collection-form').onsubmit=event=>{event.preventDefault();action(async()=>{
  const selected=[...$('collection-members').querySelectorAll('input:checked')].map(x=>x.value);
  const visible=new Set([...$('collection-members').querySelectorAll('input')].map(x=>x.value));
  for(const id of state.collection?.captureIds??[])if(!visible.has(id))selected.push(id);
  const result=await api('collections',{...(state.collection?{id:state.collection.id,expectedRevision:state.collection.revision}:{}),
    title:$('collection-title').value,description:$('collection-description').value,captureIds:selected});
  await refresh();await loadCollection(result.id);
},'Collection saved.');};
$('freeze').onclick=()=>action(async()=>{
  const c=state.collection;await api('collections/'+c.id+'/freeze',{expectedRevision:c.revision,expectedSelectionSha256:c.selectionSha256});
  await loadCollection(c.id);
},'Collection edition frozen with its exact source selections and response identities.');
$('compare').onclick=()=>action(async()=>{
  const value=await api('compare',{left:$('compare-left').value,right:$('compare-right').value});$('comparison').replaceChildren(el('p',value.semantics));
  for(const change of value.changes){
    const row=el('div',undefined,'comparison-row');row.append(el('strong',change.status+' · '+change.group),el('p',change.url??'No URL'),el('small',change.fields.join(', ')));$('comparison').append(row);
  }
  if(!value.changes.length)$('comparison').append(el('p','No result-content differences in these retained responses.'));
});
action(async()=>{await refresh();await loadCaptures();reset();notice('Workspace ready. Saved content and original customer operations are retained.');});
