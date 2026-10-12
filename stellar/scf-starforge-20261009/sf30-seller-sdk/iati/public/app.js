/* MIT. Original IATI source/portfolio operations. Reported financial values stay strings. */
'use strict';
(() => {
const $=id=>document.getElementById(id),short=x=>String(x??'').slice(0,12);
let token=location.hash.slice(1);
try{token ||= sessionStorage.getItem('sf30.iati.token');if(token)sessionStorage.setItem('sf30.iati.token',token);
 if(location.hash)history.replaceState(null,'',location.pathname+location.search);}catch{}
let state={sources:[],plans:[],builds:[],comparisons:[]},portfolios=[],presets=[];
let source=null,portfolio=null,report=null,comparison=null,changesOffset=0,nextChanges=null;
let currentQuery={},queryBase={},cursor=null,queryHistory=[],busy=false,savedPlan=null;
let pending=null;try{pending=JSON.parse(sessionStorage.getItem('sf30.iati.pending-portfolio')||'null');}catch{}
const status=(message,error=false)=>{$('status').textContent=message;$('status').classList.toggle('error',error);};
const label=name=>String(name).replace(/([a-z0-9])([A-Z])/g,'$1 $2').replace(/[_-]/g,' ').replace(/^./,s=>s.toUpperCase());
const display=value=>value===null?'Not supplied':value===undefined?'—':typeof value==='object'?JSON.stringify(value):String(value);
const json=(holder,value)=>{const pre=document.createElement('pre');pre.className='original-json';pre.textContent=JSON.stringify(value,null,2);holder.append(pre);};
function show(view){document.querySelectorAll('[data-panel]').forEach(el=>el.hidden=el.dataset.panel!==view);
 document.querySelectorAll('nav [data-view]').forEach(el=>{el.classList.toggle('active',el.dataset.view===view);el.setAttribute('aria-current',el.dataset.view===view?'page':'false');});
 if(matchMedia('(max-width:600px)').matches)$('main').scrollIntoView({block:'start',behavior:'smooth'});}
document.querySelectorAll('[data-view]').forEach(button=>button.addEventListener('click',()=>show(button.dataset.view)));
document.querySelectorAll('[data-go]').forEach(button=>button.addEventListener('click',()=>show(button.dataset.go)));
async function request(path,options={}){
 const result=await fetch(path,{...options,redirect:'error',headers:{authorization:'Bearer '+token,...options.headers}});
 if(!result.ok){let value={};try{value=await result.json();}catch{}
  throw new Error(value.error||'The original source operation returned HTTP '+result.status+'.');}
 return result;
}
const get=async path=>(await request(path)).json();
const post=async(path,value)=>(await request(path,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(value)})).json();
async function action(message,fn){
 if(busy)return;busy=true;$('main').setAttribute('aria-busy','true');status(message);
 const enabled=[...document.querySelectorAll('button,input,select,textarea')].filter(el=>!el.disabled);enabled.forEach(el=>el.disabled=true);
 try{await fn();}catch(error){status(error.message,true);}
 finally{busy=false;enabled.forEach(el=>el.disabled=false);$('main').setAttribute('aria-busy','false');buttons();}
}
function buttons(){
 $('query-next').disabled=busy||!cursor;$('query-prev').disabled=busy||!queryHistory.length;
 $('changes-next').disabled=busy||nextChanges===null;$('changes-download').disabled=busy||!comparison;
 for(const id of ['portfolio-download','report-download','report-json'])$(id).disabled=busy||!portfolio;
 $('retry-portfolio').hidden=!pending;$('retry-portfolio').disabled=busy||!pending;
 $('pending-request').textContent=pending?'Retained request '+pending.requestId+'. Retry this exact selection after an interrupted reply.':'';
}
function select(id,items,selected){
 const input=$(id),before=selected??input.value;input.replaceChildren(new Option(items.length?'Choose a retained record':'No retained records',''));
 for(const item of items)input.add(new Option(item.label,item.id));
 input.value=items.some(v=>v.id===before)?before:items[0]?.id??'';
}
function metrics(holder,values){holder.replaceChildren();holder.classList.remove('empty');
 for(const [name,value,digest=false]of values){const box=document.createElement('div');box.className='metric'+(digest?' digest':'');
 const strong=document.createElement('strong'),span=document.createElement('span');strong.textContent=display(value);span.textContent=name;box.append(strong,span);holder.append(box);}}
function table(holder,columns,rows){
 holder.replaceChildren();holder.classList.remove('empty');holder.classList.add('table-scroll');let offset=0;
 function render(){
  holder.replaceChildren();const t=document.createElement('table'),thead=document.createElement('thead'),head=document.createElement('tr'),body=document.createElement('tbody');
  for(const column of columns){const th=document.createElement('th');th.scope='col';th.textContent=typeof column==='string'?label(column):column.label;head.append(th);}
  thead.append(head);t.append(thead,body);
  for(const row of rows.slice(offset,offset+75)){const tr=document.createElement('tr');
   for(const column of columns){const key=typeof column==='string'?column:column.key,value=Array.isArray(row)?row[columns.indexOf(column)]:row[key],td=document.createElement('td');
    td.textContent=display(value);if(key==='amount'||key==='value')td.className='number';tr.append(td);}body.append(tr);}
  if(!rows.length){const tr=document.createElement('tr'),td=document.createElement('td');td.colSpan=columns.length||1;td.textContent='No records in this selected coverage.';tr.append(td);body.append(tr);}
  holder.append(t);
  if(rows.length>75){const controls=document.createElement('div');controls.className='row';const before=document.createElement('button'),after=document.createElement('button'),text=document.createElement('span');
   before.type=after.type='button';before.textContent='Previous rows';after.textContent='Next rows';before.disabled=offset===0;after.disabled=offset+75>=rows.length;text.className='fine';text.textContent=(offset+1)+'–'+Math.min(offset+75,rows.length)+' of '+rows.length+' retained rows';
   before.onclick=()=>{offset=Math.max(0,offset-75);render();};after.onclick=()=>{offset+=75;render();};controls.append(before,text,after);holder.append(controls);}
 }render();
}
function properties(holder,value){
 const dl=document.createElement('dl');dl.className='properties';
 for(const[key,item]of Object.entries(value)){const dt=document.createElement('dt'),dd=document.createElement('dd');dt.textContent=label(key);dd.textContent=display(item);dl.append(dt,dd);}holder.append(dl);
}
function section(holder,title){const part=document.createElement('section');part.className='report-section';const h=document.createElement('h3');h.textContent=title;part.append(h);holder.append(part);return part;}
function details(holder,title,value){const d=document.createElement('details'),s=document.createElement('summary');s.textContent=title;d.append(s);json(d,value);holder.append(d);}
function structured(holder,value){
 holder.replaceChildren();holder.classList.remove('empty');
 if(!value||typeof value!=='object'){holder.textContent=display(value);return;}
 for(const[key,item]of Object.entries(value)){
  const part=section(holder,label(key));
  if(Array.isArray(item)){if(item.length&&item.every(v=>v&&typeof v==='object'&&!Array.isArray(v))){
   const keys=[...new Set(item.flatMap(v=>Object.keys(v)))];const box=document.createElement('div');part.append(box);table(box,keys,item);
  }else if(item.length)properties(part,{[key]:item});else part.append(Object.assign(document.createElement('p'),{textContent:'No records.'}));}
  else if(item&&typeof item==='object'){const simple=Object.values(item).every(v=>v===null||typeof v!=='object');if(simple)properties(part,item);else details(part,'Read all original '+label(key).toLowerCase(),item);}
  else properties(part,{[key]:item});
 }
}
function sourceChoices(selected){
 const ids=new Set(selected??[...$('portfolio-sources').querySelectorAll('input:checked')].map(el=>el.value));
 $('portfolio-sources').replaceChildren();
 for(const item of state.sources){const choice=document.createElement('label');choice.className='source-choice';const input=document.createElement('input');input.type='checkbox';input.value=item.id;input.checked=ids.has(item.id);
  const text=document.createElement('span'),small=document.createElement('small');text.textContent=item.label||item.name;small.textContent=item.id+' · '+item.bytes+' bytes';text.append(small);choice.append(input,text);$('portfolio-sources').append(choice);}
 if(!state.sources.length)$('portfolio-sources').textContent='Retain a publisher source first.';
}
function cards(holder,items,open,empty){
 holder.replaceChildren();for(const item of items.slice(0,8)){const button=document.createElement('button');button.className='saved';const h=document.createElement('strong'),s=document.createElement('span');
 h.textContent=item.name||item.label;s.textContent=item.revision?'Revision '+item.revision+' · '+short(item.id):item.bytes+' bytes · '+short(item.id);button.append(h,s);button.addEventListener('click',()=>action('Opening saved source work…',()=>open(item)));holder.append(button);}
 if(!items.length){holder.className='stack empty';holder.textContent=empty;}else holder.className='stack';
}
async function refresh(selected={}){
 const [saved,ports]=await Promise.all([get('/api/state'),get('/api/iati/portfolios')]);
 if(saved.schema!=='stellar-forge.iati-workspace.v1')throw new Error('This private URL belongs to another source format.');
 state=saved;portfolios=ports.portfolios;
 const sources=state.sources.map(v=>({id:v.id,label:(v.label||v.name)+' · '+short(v.id)}));
 for(const id of ['source-select','mapping-source'])select(id,sources,selected.source);
 const portsView=portfolios.map(v=>({id:v.id,label:v.name+' · r'+v.revision}));
 for(const id of ['portfolio-select','compare-portfolio','transfer-portfolio'])select(id,portsView,selected.portfolio);
 const planViews=state.plans.map(v=>({id:v.id,label:v.name+' · '+short(v.id)}));select('plan-select',planViews,selected.plan);
 const builds=state.builds.map(v=>({id:v.id,label:(v.name||v.dataset?.name||v.native?.name||'Native edition')+' · '+v.rowCount+' rows · '+short(v.id)}));
 for(const id of ['build-select','before-build','after-build'])select(id,builds,selected[id]);
 select('comparison-select',state.comparisons.map(v=>({id:v.id,label:short(v.before)+' → '+short(v.after)+' · '+short(v.id)})),selected.comparison);
 sourceChoices();
 metrics($('overview-counts'),[['Publisher editions',state.sources.length],['Saved portfolios',portfolios.length],['Native editions',state.builds.length],['Retained comparisons',state.comparisons.length]]);
 cards($('overview-portfolios'),portfolios,async item=>{show('portfolios');await openPortfolio(item.id);},'No saved portfolios yet. Retain publisher XML to begin.');
 cards($('overview-sources'),state.sources,async item=>{show('sources');await openSource(item.id);},'The original source workspace is empty.');
 $('connection').textContent='Private source workspace';buildSummary();buttons();
}
async function openSource(id){
 if(!id)throw new Error('Choose a retained publisher edition.');
 source=await get('/api/iati/profile?source='+encodeURIComponent(id));$('source-select').value=id;
 const selected=source.source??state.sources.find(v=>v.id===id);$('source-identity').textContent=(selected?.name||'Original XML')+'\n'+id+'\n'+selected?.bytes+' original bytes';
 structured($('source-profile'),source.inventory??source);
}
function formPortfolio(value=null){
 portfolio=value;report=null;$('portfolio-name').value=value?.name??'';$('portfolio-notes').value=value?.notes??'';
 const selection=value?.selection??{};
 for(const[id,key]of [['activity-ids','activityIds'],['currencies','currencies'],['transaction-types','transactionTypes'],['budget-types','budgetTypes']])$(id).value=(selection[key]??[]).join('\n');
 $('date-from').value=selection.dateFrom??'';$('date-to').value=selection.dateTo??'';
 $('review-status').value=value?.review?.status??'draft';$('reviewer').value=value?.review?.reviewer??'';$('review-note').value=value?.review?.note??'';
 sourceChoices(value?.sources??(source?.source?.id?[source.source.id]:[]));
 $('portfolio-form-title').textContent=value?'Review a new portfolio revision':'Create portfolio';
 $('portfolio-mode').textContent=value?'Editing revision '+value.revision:'New selection';
 $('portfolio-revision').value=value?.revision??'';
 $('portfolio-identity').textContent=value?value.id+'\nRevision '+value.revision+'\nDefinition '+value.definitionSha256:'A new immutable identity is assigned to the saved request.';
 buttons();
}
function reportView(value){
 const holder=$('portfolio-report');holder.replaceChildren();holder.classList.remove('empty');$('report-revision').textContent='Revision '+(value.revision??portfolio?.revision??'');
 if(value.counts){const box=document.createElement('div');holder.append(box);metrics(box,Object.entries(value.counts).map(([k,v])=>[label(k),v]));}
 const review=section(holder,'Named review');properties(review,value.review??portfolio?.review??{status:'draft'});
 if(value.financialGroups){
  const part=section(holder,'Reported amounts by original financial context');
  const note=document.createElement('p');note.className='report-note';note.textContent='Each amount belongs to its reported organisation, activity hierarchy, currency, type, value date and budget period. The full source definitions and report notes accompany these separate groups.';part.append(note);
  const groups=Array.isArray(value.financialGroups)?value.financialGroups:Object.values(value.financialGroups).flat();
  for(const collection of ['transactions','budgets']){
   const selected=groups.filter(v=>v.collection===collection);const sub=section(part,label(collection)),box=document.createElement('div');sub.append(box);
   const keys=collection==='transactions'?['reportingOrgRef','hierarchy','currency','transactionType','transactionTypeLabel','valueDate','count','amount']:
    ['reportingOrgRef','hierarchy','currency','budgetType','budgetTypeLabel','budgetStatus','budgetStatusLabel','periodStart','periodEnd','valueDate','count','amount'];table(box,keys,selected);
  }
 }
 if(value.coverage){const coverage=section(holder,'Source coverage');const box=document.createElement('div');coverage.append(box);
 table(box,['source','activities','transactions','budgets','reportingOrgRefs'],value.coverage.bySource??[]);
 properties(coverage,Object.fromEntries(Object.entries(value.coverage).filter(([key])=>key!=='bySource')));}
 if(value.semantics){const meaning=section(holder,'Source interpretation');properties(meaning,value.semantics);}
 const editions=section(holder,'Original native editions');for(const entry of portfolio?.editions??[]){
  for(const kind of ['activities','transactions','budgets']){const build=entry[kind];if(!build)continue;const button=document.createElement('button');button.className='saved';
   button.textContent=label(kind)+' · '+build.rowCount+' rows · '+short(entry.source);button.onclick=()=>{show('query');$('build-select').value=build.id;queryHistory=[];cursor=null;buildSummary();buttons();};editions.append(button);}
 }
 details(holder,'Complete original report JSON',value);
}
async function openPortfolio(id,revision){
 if(!id)throw new Error('Choose a saved portfolio.');
 const qs=new URLSearchParams({id});if(revision)qs.set('revision',revision);
 const selected=await get('/api/iati/portfolio?'+qs);formPortfolio(selected);$('portfolio-select').value=selected.id;
 report=await get('/api/iati/report?'+new URLSearchParams({portfolio:selected.id,revision:String(selected.revision)}));reportView(report);buttons();
}
const lines=id=>$(id).value.split(/\r?\n/).map(v=>v.trim()).filter(Boolean);
function portfolioInput(){
 const sources=[...$('portfolio-sources').querySelectorAll('input:checked')].map(el=>el.value);
 if(!sources.length)throw new Error('Select at least one original publisher source.');
 const selection={};
 for(const[id,key]of [['activity-ids','activityIds'],['currencies','currencies'],['transaction-types','transactionTypes'],['budget-types','budgetTypes']]){
  const values=lines(id);if(values.length)selection[key]=values;}
 if($('date-from').value)selection.dateFrom=$('date-from').value;if($('date-to').value)selection.dateTo=$('date-to').value;
 const review={status:$('review-status').value,reviewer:$('reviewer').value,note:$('review-note').value};
 const value={name:$('portfolio-name').value,notes:$('portfolio-notes').value,sources,selection,review};
 if(portfolio){value.id=portfolio.id;value.expectedRevision=portfolio.revision;}return value;
}
function persistPending(value){pending=value;try{if(value)sessionStorage.setItem('sf30.iati.pending-portfolio',JSON.stringify(value));else sessionStorage.removeItem('sf30.iati.pending-portfolio');}catch{}buttons();}
async function savePortfolio(value){
 persistPending(value);const result=await post('/api/iati/portfolio',value);
 await refresh({portfolio:result.id});await openPortfolio(result.id,result.revision);persistPending(null);status('Portfolio revision '+result.revision+' is saved with all three original native editions.');
}
function buildSummary(){
 const build=state.builds.find(v=>v.id===$('build-select').value);if(!build){$('build-summary').replaceChildren();return;}
 metrics($('build-summary'),[['Rows',build.rowCount],['Columns',build.native?.columns?.length??0],['Native snapshot',build.native?.snapshot??build.id,true]]);
 const columns=build.native?.columns??[];
 $('query-help').textContent='Equality: '+(columns.filter(v=>v.filterable).map(v=>'where_'+v.name).join(', ')||'none')+
 '. Ranges: '+(columns.filter(v=>v.rangeFilterable).map(v=>'gte_/lte_'+v.name).join(', ')||'none')+'. Sort: '+(columns.filter(v=>v.sortable).map(v=>v.name).join(', ')||'none')+'. Native cursor and admission rules remain active.';
}
function queryValues(){const result={};for(const[key,value]of new URLSearchParams($('query-text').value.replace(/^\?/,''))){if(Object.hasOwn(result,key))throw new Error('Use each native query parameter once.');result[key]=value;}delete result.cursor;return result;}
async function runQuery(params,{next=false}={}){
 const build=$('build-select').value;if(!build)throw new Error('Choose a completed native edition.');
 const r=await post('/api/query',{build,query:params}),body=r.response?.body;
 if(r.response?.status!==200)throw new Error(body?.message||display(body?.error)||'Native query rejected.');
 if(!Array.isArray(body?.rows)||!Array.isArray(body.fields))throw new Error('The original native dataset reply is incomplete.');
 if(next)queryHistory.push(currentQuery);currentQuery={...params};cursor=body.page.nextCursor;
 table($('query-result'),body.fields.map(key=>({key,label:key})),body.rows);
 $('query-page').textContent=body.page.returned+' returned / '+body.page.total+' matching rows · native snapshot '+short(body.dataset?.snapshot);buttons();
}
async function download(path,name){
 const result=await request(path),body=await result.blob(),url=URL.createObjectURL(body),a=document.createElement('a');a.href=url;a.download=name;a.click();
 setTimeout(()=>URL.revokeObjectURL(url),3000);status('Complete original download prepared: '+name+'.');
}
async function changes(id,offset=0){
 const page=await get('/api/changes?'+new URLSearchParams({id,offset:String(offset),limit:'50'}));
 comparison=state.comparisons.find(v=>v.id===id)??{id};changesOffset=offset;nextChanges=page.nextOffset;
 table($('changes'),['kind','key','fields','before','after'],page.rows);$('changes-page').textContent=page.rows.length+' retained changes from offset '+offset+'.';
 metrics($('comparison-counts'),Object.entries(comparison.counts??{}).map(([k,v])=>[label(k),v]));buttons();
}
function presetList(value){
 const entries=Array.isArray(value)?value:Array.isArray(value.presets)?value.presets:Array.isArray(value.collections)?value.collections:
  Object.entries(value).filter(([,v])=>v&&typeof v==='object').map(([id,v])=>({id,...v}));
 return entries.map((value,index)=>({id:value.id??value.collection??String(index),label:value.label??value.name??label(value.collection??value.id??index),plan:value.plan??value.mapping??value}));
}
$('source-file').addEventListener('change',()=>{if(!$('source-label').value)$('source-label').value=$('source-file').files[0]?.name??'';});
$('source-form').addEventListener('submit',event=>{event.preventDefault();action('Retaining complete IATI XML and inspecting its source coverage…',async()=>{
 const file=$('source-file').files[0];if(!file)throw new Error('Choose a complete publisher XML file.');
 const result=await(await request('/api/source',{method:'POST',headers:{'content-type':'application/xml','X-IATI-Name':encodeURIComponent(file.name),'X-IATI-Label':encodeURIComponent($('source-label').value)},body:file})).json();
 await refresh({source:result.id});await openSource(result.id);status('Original publisher edition retained: '+result.bytes+' bytes.');});});
$('source-open').onclick=()=>action('Opening the retained source profile…',async()=>{await openSource($('source-select').value);status('Original source profile opened.');});
$('source-to-portfolio').onclick=()=>{show('portfolios');formPortfolio();if(source?.source?.id)sourceChoices([source.source.id]);};
$('portfolio-new').onclick=()=>{formPortfolio();$('portfolio-report').replaceChildren();$('portfolio-report').textContent='Save this selection to build its source-backed report.';status('New portfolio selection. Existing revisions remain retained.');};
$('portfolio-open').onclick=()=>action('Opening the exact saved portfolio revision…',async()=>{await openPortfolio($('portfolio-select').value,$('portfolio-revision').value||undefined);status('Saved portfolio and complete report opened.');});
$('portfolio-select').addEventListener('change',()=>{$('portfolio-revision').value='';$('portfolio-history-result').replaceChildren();});
$('portfolio-history').onclick=()=>action('Reading all original portfolio revisions…',async()=>{const id=$('portfolio-select').value;if(!id)throw new Error('Choose a saved portfolio.');const value=await get('/api/iati/history?portfolio='+encodeURIComponent(id));const holder=$('portfolio-history-result');holder.replaceChildren();for(const item of value.history){const button=document.createElement('button');button.className='saved';button.textContent='Revision '+item.revision+' · '+item.name+' · '+item.review.status;button.onclick=()=>action('Opening original revision '+item.revision+'…',async()=>{await openPortfolio(item.id,item.revision);status('Exact saved revision opened.');});holder.append(button);}status('All '+value.history.length+' original revisions available.');});
$('portfolio-form').addEventListener('submit',event=>{event.preventDefault();action('Saving this exact portfolio request and building original datasets…',async()=>{
 const value=portfolioInput(),old=pending?{...pending}:null;if(old)delete old.requestId;
 value.requestId=old&&JSON.stringify(old)===JSON.stringify(value)?pending.requestId:crypto.randomUUID();await savePortfolio(value);});});
$('retry-portfolio').onclick=()=>action('Continuing the same retained portfolio request…',()=>savePortfolio(pending));
$('portfolio-download').onclick=()=>action('Preparing the original full portfolio packet…',()=>download('/api/iati/export?'+new URLSearchParams({portfolio:portfolio.id,revision:String(portfolio.revision)}),'iati-portfolio.zip'));
$('report-download').onclick=()=>action('Preparing the complete report and native CSVs…',()=>download('/api/iati/report/export?'+new URLSearchParams({portfolio:portfolio.id,revision:String(portfolio.revision)}),'iati-report.zip'));
$('report-json').onclick=()=>{const holder=$('portfolio-report');details(holder,'Original selected report JSON',report);holder.lastChild.open=true;holder.lastChild.scrollIntoView({block:'start'});};
$('query-form').addEventListener('submit',event=>{event.preventDefault();action('Querying the original SF30 edition…',async()=>{queryBase=queryValues();queryHistory=[];await runQuery(queryBase);status('Original native query completed.');});});
$('query-next').onclick=()=>action('Reading the next original cursor page…',()=>runQuery({...queryBase,cursor},{next:true}));
$('query-prev').onclick=()=>action('Reading the previous original page…',()=>runQuery(queryHistory.pop()));
$('build-select').addEventListener('change',()=>{queryHistory=[];cursor=null;buildSummary();$('query-result').replaceChildren();$('query-page').textContent='Run a query against this selected edition.';buttons();});
$('dataset-download').onclick=()=>action('Preparing original native CSV, configuration and lineage…',()=>download('/api/dataset-export?build='+$('build-select').value,'iati-native-dataset.zip'));
$('project-download').onclick=()=>action('Preparing the complete original native source project…',()=>download('/api/export?build='+$('build-select').value,'iati-source-project.zip'));
$('preset-load').onclick=()=>{const selected=presets.find(v=>v.id===$('preset-select').value);if(selected){$('plan-json').value=JSON.stringify(selected.plan,null,2);savedPlan=null;}};
$('plan-load').onclick=()=>action('Opening the original saved mapping…',async()=>{const value=await get('/api/plan?id='+$('plan-select').value);$('plan-json').value=JSON.stringify(value.plan,null,2);savedPlan=value.id;status('Saved mapping opened.');});
$('plan-save').onclick=()=>action('Validating and saving the complete mapping…',async()=>{const value=await post('/api/plan',JSON.parse($('plan-json').value));savedPlan=value.id;await refresh({plan:value.id});status('Immutable native mapping saved.');});
$('mapping-build').onclick=()=>action('Building the selected source through the original native engine…',async()=>{const plan=await post('/api/plan',JSON.parse($('plan-json').value));savedPlan=plan.id;const value=await post('/api/build',{source:$('mapping-source').value,plan:plan.id});await refresh({plan:plan.id,'build-select':value.id});queryHistory=[];queryBase={limit:String(Math.min(25,value.native.maxLimit))};$('query-text').value=new URLSearchParams(queryBase).toString();await runQuery(queryBase);status('Complete native edition built and queried.');});
$('portfolio-compare-form').addEventListener('submit',event=>{event.preventDefault();action('Comparing complete saved portfolio revisions and source coverage…',async()=>{
 const value={id:$('compare-portfolio').value,beforeRevision:Number($('compare-before-revision').value),afterRevision:Number($('compare-after-revision').value)};
 if($('compare-pairs').value.trim())value.pairs=JSON.parse($('compare-pairs').value);
 const result=await post('/api/iati/compare',value);structured($('portfolio-comparison'),result);await refresh();status('Portfolio comparison retained with original source coverage.');});});
$('native-compare-form').addEventListener('submit',event=>{event.preventDefault();action('Comparing every keyed native row…',async()=>{
 const value=await post('/api/compare',{before:$('before-build').value,after:$('after-build').value});await refresh({comparison:value.id});await changes(value.id);status('Complete native edition changes retained.');});});
$('comparison-open').onclick=()=>action('Opening the original retained change file…',()=>changes($('comparison-select').value));
$('changes-next').onclick=()=>action('Reading retained changes…',()=>changes(comparison.id,nextChanges));
$('changes-download').onclick=()=>action('Preparing every original retained change…',()=>download('/api/changes/download?id='+comparison.id,'iati-edition-changes.jsonl'));
$('receive-form').addEventListener('submit',event=>{event.preventDefault();action('Verifying the original packet and reconstructing its complete source identity…',async()=>{
 const file=$('receive-file').files[0];if(!file)throw new Error('Choose a complete original portfolio or project packet.');
 const result=await(await request('/api/import',{method:'POST',headers:{'content-type':'application/zip'},body:file})).json();structured($('receive-result'),result);await refresh();
 if(result.portfolio){const id=typeof result.portfolio==='string'?result.portfolio:result.portfolio.id;await openPortfolio(id);show('portfolios');}
 else if(result.build?.id){$('build-select').value=result.build.id;buildSummary();}
 status('Original source packet received and reconstructed.');});});
$('transfer-download').onclick=()=>action('Preparing a complete saved portfolio handover…',()=>{const id=$('transfer-portfolio').value;if(!id)throw new Error('Choose a saved portfolio.');
 const q=new URLSearchParams({portfolio:id});if($('transfer-revision').value)q.set('revision',$('transfer-revision').value);return download('/api/iati/export?'+q,'iati-portfolio.zip');});
$('reload').onclick=()=>action('Refreshing the original saved workspace…',async()=>{await refresh();status('Retained source, portfolio and native edition inventory refreshed.');});
action('Opening the original private IATI workspace…',async()=>{
 if(!token)throw new Error('Open the private console URL printed by this original process.');
 await refresh();const catalogue=await get('/api/iati/presets');presets=presetList(catalogue);select('preset-select',presets);
 for(const [id,key] of [['transaction-types','transactionTypes'],['budget-types','budgetTypes']]){const note=document.createElement('small');note.className='fine';note.textContent=Object.entries(catalogue[key]??{}).map(([code,title])=>code+' · '+title).join('; ');$(id).parentElement.append(note);}
 if(presets.length)$('plan-json').value=JSON.stringify(presets[0].plan,null,2);
 status(state.sources.length+' original publisher editions · '+portfolios.length+' portfolios · '+state.builds.length+' native editions.');});
})();
