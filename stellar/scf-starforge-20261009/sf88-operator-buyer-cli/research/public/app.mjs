// MIT. Industrial research workspace. Provider content is rendered only as text or validated links.
const $=id=>document.getElementById(id),el=(tag,text,cls)=>{const node=document.createElement(tag);if(text!==undefined)node.textContent=String(text);if(cls)node.className=cls;return node;};
const pretty=value=>JSON.stringify(value,null,2),count=value=>value===null||value===undefined?'—':new Intl.NumberFormat().format(value);
const human=value=>String(value).replace(/([a-z])([A-Z])/g,'$1 $2').replace(/[_-]/g,' ').replace(/^./,c=>c.toUpperCase());
const date=value=>value?new Date(value).toLocaleString():'—';
const short=value=>value?.replace('https://openalex.org/','')??'—';
const state={catalog:{queries:[],editions:[],jobs:[],retrieval:null},queryId:null,editionId:null,edition:null,tab:'records',draw:0,
  recordsOffset:0,summaryOffset:0,comparisonOffset:0,comparison:null,record:null,editingQuery:null,poll:null};
let token='',pollBusy=false,recordSequence=0;
try{token=sessionStorage.getItem('researchWorkspaceToken')??'';}catch{}
const fragment=new URLSearchParams(location.hash.slice(1));
if(fragment.get('token')){
  token=fragment.get('token');
  try{sessionStorage.setItem('researchWorkspaceToken',token);history.replaceState(null,'',location.pathname+location.search);}catch{}
}
function notice(message){$('notice').textContent=message;$('notice').hidden=!message;}
function failure(error){notice(error.message??String(error));}
async function api(path,{method='GET',data,form}={}){
  const headers={authorization:'Bearer '+token};
  if(data!==undefined)headers['content-type']='application/json';
  const response=await fetch(path,{method,headers,body:form??(data===undefined?undefined:JSON.stringify(data)),cache:'no-store'});
  if(!response.ok){
    let detail;try{detail=await response.json();}catch{}
    throw new Error(detail?.message??detail?.error??'The workspace request failed ('+response.status+').');
  }
  return response.json();
}
async function download(path,name){
  const response=await fetch(path,{headers:{authorization:'Bearer '+token},cache:'no-store'});
  if(!response.ok){let detail;try{detail=await response.json();}catch{}throw new Error(detail?.message??'The download could not be created.');}
  const url=URL.createObjectURL(await response.blob()),link=el('a');link.href=url;link.download=name;document.body.append(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),60000);
}
async function work(action,button){
  if(button){button.disabled=true;button.classList.add('button-busy');}
  notice('');
  try{return await action();}catch(error){failure(error);}
  finally{if(button){button.disabled=false;button.classList.remove('button-busy');if(['gather','stop-gather'].includes(button.id))renderHeader();}}
}
function bind(id,action,event='click'){$(id).addEventListener(event,e=>{if(event==='submit')e.preventDefault();void work(()=>action(e),event==='click'?e.currentTarget:null);});}
function link(text,url){
  let parsed;try{parsed=new URL(url);}catch{return el('span',text);}
  if(!['http:','https:'].includes(parsed.protocol))return el('span',text);
  const node=el('a',text);node.href=parsed.href;node.target='_blank';node.rel='noopener noreferrer';return node;
}
function textOf(value){
  if(value===null||value===undefined)return '—';
  if(Array.isArray(value))return value.map(v=>v?.name??v?.title??v?.id??String(v)).join('; ')||'—';
  if(typeof value==='object')return value.name??value.title??value.id??pretty(value);
  return String(value);
}
function addFact(parent,label,value){parent.append(el('dt',label),el('dd',textOf(value)));}
function selectedQuery(){return state.catalog.queries.find(query=>query.id===state.queryId);}
function editionsForQuery(){return state.catalog.editions.filter(edition=>edition.record.queryId===state.queryId);}
function currentJob(){return state.catalog.jobs.find(job=>job.editionId===state.editionId);}
function endpoint(suffix=''){return '/api/editions/'+encodeURIComponent(state.editionId)+suffix;}
function queryString(values){const params=new URLSearchParams();for(const [k,v] of Object.entries(values))if(v!==undefined&&v!==null&&v!=='')params.set(k,String(v));return params.toString();}
function emptyList(message){return el('p',message,'muted');}
function renderSidebar(){
  const filter=$('sidebar-search').value.trim().toLowerCase(),queries=$('query-list'),editions=$('edition-list');
  queries.replaceChildren();editions.replaceChildren();
  for(const query of state.catalog.queries.filter(q=>(q.label+' '+q.id+' '+q.entity).toLowerCase().includes(filter))){
    const button=el('button');button.type='button';button.setAttribute('aria-pressed',String(query.id===state.queryId));
    button.append(el('strong',query.label),el('span',human(query.entity)+' · revision '+query.revision));
    button.addEventListener('click',()=>void work(()=>chooseQuery(query.id),button));queries.append(button);
  }
  if(!queries.children.length)queries.append(emptyList(state.catalog.queries.length?'No matching queries.':'No saved queries yet.'));
  for(const edition of editionsForQuery().filter(e=>(e.record.label+' '+e.record.id).toLowerCase().includes(filter))){
    const button=el('button');button.type='button';button.setAttribute('aria-pressed',String(edition.record.id===state.editionId));
    button.append(el('strong',edition.record.label),el('span',human(edition.coverage.state)+' · '+count(edition.coverage.recordsReceived)+' received · r'+edition.query.revision));
    button.addEventListener('click',()=>void work(()=>chooseEdition(edition.record.id),button));editions.append(button);
  }
  if(!editions.children.length)editions.append(emptyList('Create an edition to retain a collection.'));
  $('new-edition').disabled=!selectedQuery();
  const source=$('source-status'),retrieval=state.catalog.retrieval;source.replaceChildren();
  source.append(el('strong',retrieval?'Retrieval connected':'Import received pages'));
  source.append(el('p',retrieval?.description??'Configure a research source or original buyer profile when starting this workspace to retrieve saved queries.'));
  if(retrieval){const detail=el('details'),summary=el('summary','Source capacity');detail.append(summary,el('pre',pretty(retrieval.status)));source.append(detail);}
}
function renderEmpty(){
  $('edition-workspace').hidden=true;$('empty').hidden=false;
  const query=selectedQuery();$('empty').querySelector('h1').textContent=query?query.label:'Build a research collection';
  $('empty-new-query').textContent=query?'Create an edition':'Create a query';
}
function renderHeader(){
  const edition=state.edition;if(!edition){renderEmpty();return;}
  $('empty').hidden=true;$('edition-workspace').hidden=false;
  $('edition-kicker').textContent=human(edition.query.entity)+' · query revision '+edition.query.revision;
  $('edition-title').textContent=edition.record.label;
  $('edition-description').textContent=edition.record.id+' · created '+date(edition.record.createdAt);
  const coverage=edition.coverage,counts=edition.analysis.counts,job=currentJob(),running=job&&['RUNNING','STOPPING'].includes(job.state);
  $('coverage-status').textContent=(running?human(job.state):human(coverage.state))+' · '+count(counts.uniqueRecords)+' unique records · '+count(coverage.pages)+' pages';
  const reported=coverage.totalReported;
  $('coverage-progress').value=coverage.state==='COMPLETE'?100:reported>0?Math.min(99,coverage.recordsReceived/reported*100):0;
  $('coverage-detail').textContent=count(coverage.recordsReceived)+' received'+(reported===null?'':' / '+count(reported)+' provider matches')+
    (coverage.firstRetrievedAt?' · '+date(coverage.firstRetrievedAt)+' to '+date(coverage.lastRetrievedAt):' · ready for the first page');
  const warnings=$('coverage-warnings');warnings.replaceChildren();
  for(const warning of coverage.warnings??[])warnings.append(el('p',warning));
  if(job?.error)warnings.append(el('p',job.error.message));
  else if(edition.pending?.state==='INTERRUPTED'&&edition.pending.error)warnings.append(el('p',edition.pending.error.message));
  $('gather').disabled=!state.catalog.retrieval||running||['COMPLETE','INTERRUPTED'].includes(coverage.state);
  $('gather').textContent=coverage.pages?'Continue retrieval':'Retrieve edition';
  $('stop-gather').hidden=!running;$('stop-gather').disabled=job?.state==='STOPPING';
  $('receive-details').hidden=['COMPLETE','INTERRUPTED'].includes(coverage.state);
}
async function chooseQuery(id){
  state.queryId=id;state.editionId=editionsForQuery()[0]?.record.id??null;state.edition=null;state.comparison=null;
  state.recordsOffset=0;renderSidebar();
  if(state.editionId)await loadEdition();else renderEmpty();
}
async function chooseEdition(id){
  state.editionId=id;state.edition=null;state.comparison=null;state.recordsOffset=0;state.summaryOffset=0;state.comparisonOffset=0;
  const listed=state.catalog.editions.find(e=>e.record.id===id);if(listed)state.queryId=listed.record.queryId;
  renderSidebar();await loadEdition();
}
async function loadEdition(){
  const id=state.editionId;if(!id){state.edition=null;renderEmpty();return;}
  const edition=await api('/api/editions/'+encodeURIComponent(id));if(state.editionId!==id)return;
  state.edition=edition;renderHeader();await renderTab();
}
async function refresh(){
  state.catalog=await api('/api/state');
  if(!state.catalog.queries.some(q=>q.id===state.queryId))state.queryId=state.catalog.queries[0]?.id??null;
  if(!state.catalog.editions.some(e=>e.record.id===state.editionId))state.editionId=editionsForQuery()[0]?.record.id??null;
  renderSidebar();await loadEdition();schedulePoll();
}
function schedulePoll(){
  clearTimeout(state.poll);
  if(state.catalog.jobs.some(job=>['RUNNING','STOPPING'].includes(job.state))){
    state.poll=setTimeout(async()=>{
      if(pollBusy){schedulePoll();return;}pollBusy=true;
      try{await refresh();}catch(error){failure(error);}finally{pollBusy=false;}
    },2500);
  }
}
function table(target,columns,rows,renderCell){
  const container=$(target);container.replaceChildren();
  if(!rows.length){container.append(el('div','No records match this view.','empty-table'));return;}
  const node=el('table'),thead=el('thead'),tr=el('tr'),tbody=el('tbody');
  for(const column of columns){const th=el('th',column.label??human(column.key));th.scope='col';tr.append(th);}thead.append(tr);node.append(thead,tbody);
  for(const row of rows){const line=el('tr');for(const column of columns){const cell=el('td');const content=renderCell?.(row,column);
    if(content instanceof Node)cell.append(content);else cell.textContent=content??textOf(row[column.key]);line.append(cell);}tbody.append(line);}
  container.append(node);
}
function pager(target,page,change){
  const container=$(target);container.replaceChildren(el('span',page.total?count(page.offset+1)+'–'+count(Math.min(page.offset+page.limit,page.total))+' of '+count(page.total):'0 records'));
  for(const [label,offset,disabled] of [['Previous',Math.max(0,page.offset-page.limit),page.offset===0],['Next',page.offset+page.limit,!page.hasMore]]){
    const button=el('button',label);button.type='button';button.disabled=disabled;button.addEventListener('click',()=>void work(()=>change(offset),button));container.append(button);
  }
}
function rowTitle(row,action){
  const block=el('div'),button=el('button',row.title??row.name??row.id,'record-button');button.type='button';button.addEventListener('click',()=>void work(action,button));block.append(button);
  const byline=(row.authors??[]).map(a=>a.name??short(a.id)).slice(0,4).join(', ')+(row.authors?.length>4?' and '+count(row.authors.length-4)+' more':'');
  block.append(el('small',[byline,row.source?.name,short(row.id)].filter(Boolean).join(' · ')));return block;
}
async function renderRecords(current){
  const [sort,direction]=$('record-sort').value.split(':');
  const page=await api(endpoint('/tables/records?')+queryString({offset:state.recordsOffset,limit:50,q:$('record-search').value,decision:$('decision-filter').value,sort,direction}));
  if(!current())return;
  const works=state.edition.query.entity==='works',columns=works?
    [{key:'title',label:'Work'},{key:'publicationYear',label:'Year'},{key:'type'},{key:'citedByCount',label:'Citations'},{key:'oaStatus',label:'Access'},{key:'decision',label:'Review'}]:
    [{key:'title',label:'Name'},{key:'type'},{key:'countryCode',label:'Country'},{key:'providerWorksCount',label:'Provider works'},{key:'citedByCount',label:'Provider citations'},{key:'decision',label:'Review'}];
  const editionId=state.editionId;
  table('records-table',columns,page.rows,(row,col)=>{
    if(col.key==='title')return rowTitle(row,()=>openRecord(row.id,editionId));
    if(col.key==='decision')return el('span',human(row.decision?.status??'undecided'),'badge');
    if(['publicationYear','citedByCount','providerWorksCount'].includes(col.key))return count(row[col.key]);
    return textOf(row[col.key]);
  });
  pager('records-pager',page,async offset=>{state.recordsOffset=offset;await renderTab();});
}
function metrics(target,items){
  const node=$(target);node.replaceChildren();
  for(const [label,value] of items){const metric=el('div',undefined,'metric');metric.append(el('strong',count(value)),el('span',label));node.append(metric);}
}
function scalarColumns(rows){
  const row=rows[0]??{},keys=Object.keys(row).filter(k=>!Array.isArray(row[k])&&(row[k]===null||typeof row[k]!=='object'));
  const first=['name','label','year','type','countryCode','status','records','recordCount','includedRecords','count','value'].filter(k=>keys.includes(k));
  const selected=[...new Set([...first,...keys])].filter(k=>k!=='id'||keys.length<4).slice(0,9);
  return selected.map(key=>({key}));
}
async function renderSummary(current){
  const edition=state.edition,counts=edition.analysis.counts;
  metrics('summary-counts',[['Unique records',counts.uniqueRecords],['Included',counts.included],['Excluded',counts.excluded],['Undecided',counts.undecided],['Duplicate observations',counts.duplicates]]);
  const select=$('summary-table'),old=select.value;
  select.replaceChildren();
  for(const [name,total] of Object.entries(edition.tables).filter(([key])=>key!=='records')){const option=el('option',human(name)+' · '+count(total));option.value=name;select.append(option);}
  select.value=Object.hasOwn(edition.tables,old)&&old!=='records'?old:edition.tables.years!==undefined?'years':select.options[0]?.value;
  $('summary-notes').textContent=edition.query.entity==='works'?'Groups retain their OpenAlex identities. Affiliation and topic memberships may overlap.':'Provider profile works and citation counts describe each entity. They are not added into a cohort citation total.';
  $('analysis-details').textContent=pretty(edition.analysis);
  if(!select.value){$('summary-results').replaceChildren();return;}
  const page=await api(endpoint('/tables/'+encodeURIComponent(select.value)+'?')+queryString({offset:state.summaryOffset,limit:50,q:$('summary-search').value}));
  if(!current())return;
  table('summary-results',scalarColumns(page.rows),page.rows,(row,col)=>typeof row[col.key]==='number'?count(row[col.key]):textOf(row[col.key]));
  pager('summary-pager',page,async offset=>{state.summaryOffset=offset;await renderTab();});
}
function downloadButton(label,path,name){
  const button=el('button',label,'cell-action');button.type='button';button.addEventListener('click',()=>void work(()=>download(path,name),button));return button;
}
function renderSources(){
  const edition=state.edition;$('query-details').textContent=pretty(edition.query);
  $('pages-count').textContent=count(edition.pages.length)+' pages · '+human(edition.coverage.state);
  table('pages-table',[{key:'index',label:'Page'},{key:'records'},{key:'retrievedAt',label:'Retrieved'},{key:'source',label:'Source'},{key:'files',label:'Files'}],edition.pages,(page,column)=>{
    if(column.key==='retrievedAt')return date(page.source.retrievedAt);
    if(column.key==='source'){const value=el('div');value.append(link(page.source.kind,page.source.url),el('small',page.sha256));return value;}
    if(column.key==='files'){const group=el('div',undefined,'actions');for(const name of ['response.json','request.json','page.json',...(page.nativeSha256?['buyer-result.json']:[])])
      group.append(downloadButton(name.replace('.json',''),endpoint('/pages/'+page.index+'/'+name),state.editionId+'-page-'+page.index+'-'+name));return group;}
    return count(page[column.key]);
  });
}
function comparisonParams(extra={}){return queryString({before:$('compare-before').value,after:state.editionId,...extra});}
function renderCompareOptions(){
  const select=$('compare-before'),old=select.value;select.replaceChildren();
  const candidates=state.catalog.editions.filter(e=>e.record.id!==state.editionId&&e.query.entity===state.edition.query.entity);
  for(const edition of candidates){const option=el('option',edition.record.label+' · '+count(edition.coverage.recordsReceived)+' records');option.value=edition.record.id;select.append(option);}
  if(candidates.some(e=>e.record.id===old))select.value=old;
  $('compare-load').disabled=!candidates.length;
  if(!candidates.length)$('comparison-context').textContent='Create another edition of this entity to compare membership and metadata.';
}
async function loadComparison(){
  if(!$('compare-before').value)return;
  state.comparison=await api('/api/compare?'+comparisonParams());state.comparisonOffset=0;await renderTab();
}
async function renderComparison(current){
  renderCompareOptions();const compared=state.comparison;
  $('copy-decisions').disabled=!compared||compared.before.record.id!==$('compare-before').value;
  if(!compared){$('comparison-counts').replaceChildren();$('comparison-results').replaceChildren();$('comparison-pager').replaceChildren();$('comparison-details').textContent='';return;}
  const counts=compared.comparison.counts;
  metrics('comparison-counts',[['Earlier records',counts.before],['Current records',counts.after],['Added',counts.added],['Removed',counts.removed],['Changed',counts.changed],['Unchanged',counts.unchanged]]);
  $('comparison-context').textContent=compared.before.record.label+' → '+compared.after.record.label+
    (compared.before.query.sha256!==compared.after.query.sha256?'. These editions use different query revisions; compare their saved parameters below.':'. Both editions use the same saved query.');
  $('comparison-details').textContent=pretty({before:compared.before,after:compared.after,method:compared.comparison.method});
  const which=$('comparison-table').value,page=await api('/api/compare?'+comparisonParams({table:which,offset:state.comparisonOffset,limit:50,q:$('comparison-search').value}));
  if(!current())return;
  const columns=which==='changed'?[{key:'title',label:'Record'},{key:'changedFields',label:'Changed fields'},{key:'details',label:'Details'}]:
    [{key:'title',label:'Record'},{key:'publicationYear',label:'Year'},{key:'type'},{key:'citedByCount',label:'Citations'}];
  table('comparison-results',columns,page.rows,(row,col)=>{
    if(col.key==='title')return rowTitle(row,()=>which==='changed'?showDifference(row):openRecord(row.id,which==='removed'?compared.before.record.id:state.editionId,which==='removed'));
    if(col.key==='details'){const button=el('button','View changes','cell-action');button.addEventListener('click',()=>showDifference(row));return button;}
    if(col.key==='changedFields')return row.changedFields.map(human).join(', ');
    return typeof row[col.key]==='number'?count(row[col.key]):textOf(row[col.key]);
  });
  pager('comparison-pager',page,async offset=>{state.comparisonOffset=offset;await renderTab();});
}
async function renderExports(current){
  const data=await api(endpoint('/export-index'));if(!current())return;
  const parent=$('export-files');parent.replaceChildren();
  for(const item of [...data.files,{name:'manifest.json',bytes:null}]){
    const button=el('button');button.type='button';button.append(el('strong',item.name),el('small',item.bytes===null?'Collection file index':count(item.bytes)+' bytes'));
    const path=endpoint('/download/'+encodeURIComponent(item.name));button.addEventListener('click',()=>void work(()=>download(path,item.name),button));parent.append(button);
  }
}
async function renderTab(){
  if(!state.edition)return;
  for(const button of $('tabs').querySelectorAll('button')){if(button.dataset.tab===state.tab)button.setAttribute('aria-current','page');else button.removeAttribute('aria-current');}
  for(const name of ['records','summary','sources','compare','exports'])$('panel-'+name).hidden=name!==state.tab;
  const stamp=++state.draw,current=()=>state.draw===stamp;
  if(state.tab==='records')await renderRecords(current);
  else if(state.tab==='summary')await renderSummary(current);
  else if(state.tab==='sources')renderSources();
  else if(state.tab==='compare')await renderComparison(current);
  else if(state.tab==='exports')await renderExports(current);
}
function showQuery(query=null){
  const form=$('query-form');form.reset();state.editingQuery=query;
  $('query-dialog-title').textContent=query?'Edit saved query':'New query';
  $('query-revision-note').textContent=query?'Saving a change creates revision '+(query.revision+1)+'. Existing editions retain their saved query.':'Choose a research question and its OpenAlex search or filters.';
  form.elements.id.disabled=Boolean(query);form.elements.id.value=query?.id??'';
  form.elements.label.value=query?.label??'';form.elements.entity.value=query?.entity??'works';
  const parameters={...(query?.parameters??{})},searchFields=[...form.elements.searchField.options].map(o=>o.value),searchField=searchFields.find(key=>parameters[key])??'search';
  form.elements.searchField.value=searchField;form.elements.search.value=parameters[searchField]??'';delete parameters[searchField];
  for(const field of ['filter','sort','select','per_page','corpus']){form.elements[field].value=parameters[field]??(field==='per_page'?'100':'');delete parameters[field];}
  form.elements.additional.value=pretty(parameters);$('query-dialog').showModal();syncQueryEntity();
}
function syncQueryEntity(){
  const form=$('query-form'),works=form.elements.entity.value==='works';
  for(const option of form.elements.searchField.options)option.disabled=!works&&option.value!=='search';
  if(!works)form.elements.searchField.value='search';
  form.elements.corpus.disabled=!works;if(!works)form.elements.corpus.value='';
}
function showEdition(){
  const query=selectedQuery();if(!query)return;
  const form=$('edition-form');form.reset();
  const stamp=new Date().toISOString().replace(/\D/g,'').slice(0,14);
  form.elements.id.value=query.id.slice(0,64)+'-'+stamp;form.elements.label.value=(query.label+' · '+new Date().toISOString().slice(0,10)).slice(0,200);
  form.elements.queryRevision.value=query.revision;form.elements.queryRevision.max=query.revision;
  $('edition-query-note').textContent=query.label+' · '+human(query.entity)+'. This edition retains the selected query revision.';
  $('edition-dialog').showModal();
}
function abstract(value){
  if(!value||typeof value!=='object'||Array.isArray(value))return '';
  const tokens=[];for(const [word,positions] of Object.entries(value))if(Array.isArray(positions))for(const position of positions){
    if(Number.isSafeInteger(position)&&position>=0&&position<100000)tokens.push([position,word]);
  }
  return tokens.sort((a,b)=>a[0]-b[0]).map(([,word])=>word).join(' ');
}
async function openRecord(id,editionId=state.editionId,readonly=false){
  const request=++recordSequence,data=await api('/api/editions/'+encodeURIComponent(editionId)+'/record?'+queryString({id}));
  if(request!==recordSequence)return;state.record={...data,editionId,readonly};
  const row=data.record;$('record-title').textContent=row.title??row.id;
  const links=$('record-links');links.replaceChildren(link('OpenAlex',row.id));
  for(const [label,url] of [['DOI',row.doi],['Landing page',row.landingPageUrl],['Open access',row.oaUrl],['PDF',row.pdfUrl],['Homepage',row.homepageUrl]])if(url)links.append(link(label,url));
  const facts=$('record-facts');facts.replaceChildren();
  for(const [label,value] of [['ID',row.id],['Publication',row.publicationDate??row.publicationYear],['Type',row.type],['Citations',row.citedByCount],
    ['Authors',row.authors],['Institutions',row.institutions],['Topics',row.topics],['Funders',row.funders],['Awards',row.awards],['Source',row.source],
    ['Access',row.oaStatus],['Retraction status',row.isRetracted===null?'Not provided':row.isRetracted?'Retracted':'Not retracted']])addFact(facts,label,value);
  const excerpt=abstract(data.provider?.abstract_inverted_index),abstractNode=$('record-abstract');abstractNode.replaceChildren();
  if(excerpt)abstractNode.append(el('h3','Abstract'),el('p',excerpt));
  $('record-json').textContent=pretty(data.provider);
  const form=$('decision-form');form.hidden=readonly;
  form.elements.status.value=row.decision.status;form.elements.notes.value=row.decision.notes;form.elements.tags.value=row.decision.tags.join(', ');
  $('decision-status').textContent='';
  if(readonly)abstractNode.prepend(el('p','Record from the earlier edition.','muted'));
  if(!$('record-dialog').open)$('record-dialog').showModal();
}
function showDifference(row){
  state.record=null;recordSequence++;$('record-title').textContent=row.title??row.id;$('record-links').replaceChildren(link('OpenAlex',row.id));
  $('record-facts').replaceChildren();addFact($('record-facts'),'Changed fields',row.changedFields);$('record-abstract').replaceChildren();
  $('record-json').textContent=pretty({before:row.before,after:row.after});$('record-json').parentElement.open=true;$('decision-form').hidden=true;
  if(!$('record-dialog').open)$('record-dialog').showModal();
}
function debounce(action,delay=220){let timer;return()=>{clearTimeout(timer);timer=setTimeout(()=>void work(action),delay);};}
for(const button of document.querySelectorAll('[data-close]'))button.addEventListener('click',()=>$(button.dataset.close).close());
$('record-dialog').addEventListener('close',()=>{recordSequence++;state.record=null;});
bind('refresh',refresh);bind('new-query',()=>showQuery());bind('new-edition',showEdition);
bind('empty-new-query',()=>selectedQuery()?showEdition():showQuery());bind('edit-query',()=>showQuery(selectedQuery()));
$('sidebar-search').addEventListener('input',renderSidebar);
$('tabs').addEventListener('click',e=>{const tab=e.target.closest('button')?.dataset.tab;if(tab){state.tab=tab;void work(renderTab);}});
$('query-form').elements.entity.addEventListener('change',syncQueryEntity);
bind('query-form',async()=>{
  const form=$('query-form'),additional=JSON.parse(form.elements.additional.value||'{}');
  if(!additional||typeof additional!=='object'||Array.isArray(additional))throw new Error('Additional parameters must be a JSON object.');
  const parameters={...additional};for(const field of ['filter','sort','select','per_page','corpus'])if(form.elements[field].value)parameters[field]=form.elements[field].value.trim();
  if(form.elements.search.value.trim())parameters[form.elements.searchField.value]=form.elements.search.value.trim();
  const prior=state.editingQuery,saved=await api('/api/queries',{method:'POST',data:{id:form.elements.id.value.trim(),label:form.elements.label.value.trim(),
    entity:form.elements.entity.value,parameters,expectedRevision:prior?.revision??0}});
  $('query-dialog').close();state.queryId=saved.id;if(!prior){state.editionId=null;state.edition=null;}
  await refresh();notice('Saved '+saved.label+' · revision '+saved.revision+'.');if(!prior)showEdition();
},'submit');
bind('edition-form',async()=>{
  const form=$('edition-form'),created=await api('/api/editions',{method:'POST',data:{id:form.elements.id.value.trim(),label:form.elements.label.value.trim(),
    queryId:state.queryId,queryRevision:Number(form.elements.queryRevision.value)}});
  $('edition-dialog').close();state.editionId=created.record.id;state.tab='records';await refresh();
},'submit');
bind('gather',async()=>{await api(endpoint('/gather'),{method:'POST',data:{}});await refresh();});
bind('stop-gather',async()=>{await api(endpoint('/stop'),{method:'POST',data:{}});await refresh();});
$('record-search').addEventListener('input',debounce(async()=>{state.recordsOffset=0;await renderTab();}));
for(const id of ['record-sort','decision-filter'])$(id).addEventListener('change',()=>void work(async()=>{state.recordsOffset=0;await renderTab();}));
$('summary-table').addEventListener('change',()=>void work(async()=>{state.summaryOffset=0;await renderTab();}));
$('summary-search').addEventListener('input',debounce(async()=>{state.summaryOffset=0;await renderTab();}));
bind('receive-form',async()=>{
  const data=new FormData($('receive-form'));await api(endpoint('/receive'),{method:'POST',form:data});$('receive-form').reset();await refresh();notice('Received and retained the page.');
},'submit');
bind('decision-form',async()=>{
  const selected=state.record;if(!selected||selected.readonly)return;
  const form=$('decision-form'),data=await api('/api/editions/'+encodeURIComponent(selected.editionId)+'/decisions',{method:'POST',data:{
    id:selected.record.id,expectedRevision:selected.decisionsRevision,decision:{status:form.elements.status.value,notes:form.elements.notes.value,
      tags:form.elements.tags.value.split(',').map(t=>t.trim()).filter(Boolean)}}});
  selected.decisionsRevision=data.revision;selected.record.decision=data.items[selected.record.id];$('decision-status').textContent='Saved · review revision '+data.revision;
  await loadEdition();
},'submit');
bind('compare-load',loadComparison);
$('compare-before').addEventListener('change',()=>{state.comparison=null;state.comparisonOffset=0;void work(renderTab);});
$('comparison-table').addEventListener('change',()=>void work(async()=>{state.comparisonOffset=0;await renderTab();}));
$('comparison-search').addEventListener('input',debounce(async()=>{state.comparisonOffset=0;await renderTab();}));
bind('copy-decisions',async()=>{
  const result=await api(endpoint('/copy-decisions'),{method:'POST',data:{fromEdition:$('compare-before').value,expectedRevision:state.edition.decisions.revision}});
  await loadEdition();notice('Copied review decisions for '+count(result.copied)+' overlapping records. Existing target decisions are retained.');
});
bind('download-bundle',async()=>{await download(endpoint('/bundle.zip?native='+($('include-native').checked?'1':'0')),state.editionId+'.zip');});
bind('save-export',async()=>{
  const result=await api(endpoint('/export'),{method:'POST',data:{}});$('export-status').textContent='Saved complete export: '+result.directory;
});
void work(refresh);
