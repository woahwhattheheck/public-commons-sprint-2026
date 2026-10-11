const $=id=>document.getElementById(id);
const state={captures:[],reviews:[],id:null,other:null,tab:'overview',offset:0,q:'',generation:0,current:null,comparison:null};
const fragment=new URLSearchParams(location.hash.slice(1)), key='stellar-forge-tenderly-analysis-token';
if(fragment.has('token')){sessionStorage.setItem(key,fragment.get('token'));history.replaceState(null,'',location.pathname+location.search);}
const token=sessionStorage.getItem(key)??'';
function element(tag,attributes={},children=[]){const node=document.createElement(tag);for(const [name,value]of Object.entries(attributes)){
  if(name==='class')node.className=value;else if(name==='text')node.textContent=value;else if(name.startsWith('on'))node.addEventListener(name.slice(2),value);else node.setAttribute(name,value);}
  for(const child of children)if(child!==null&&child!==undefined)node.append(typeof child==='string'?document.createTextNode(child):child);return node;}
const fmt=value=>value===null||value===undefined?'Unavailable':typeof value==='object'?JSON.stringify(value):String(value);
const short=(value,max=68)=>{const s=fmt(value);return s.length>max?s.slice(0,max)+'…':s;};
function notice(message){$('notice').textContent=message;$('notice').hidden=!message;}
async function api(path,options={}){const response=await fetch(path,{...options,headers:{Authorization:'Bearer '+token,...options.headers}});
  if(!response.ok){let error;try{error=await response.json();}catch{}throw new Error(error?.message??error?.error??'The operation could not be completed.');}return response;}
const json=async(path,options)=>(await api(path,options)).json();
function action(label,handler,className=''){return element('button',{type:'button',class:className,text:label,onclick:async event=>{
  const button=event.currentTarget;button.disabled=true;try{notice('');await handler();}catch(error){notice(error.message);}finally{button.disabled=false;}}});}
async function download(path,name){const response=await api(path),blob=await response.blob(),url=URL.createObjectURL(blob);
  const link=element('a',{href:url,download:name});link.click();setTimeout(()=>URL.revokeObjectURL(url),30000);}
function openReceive(){$('receive-dialog').showModal();}
$('receive-open').onclick=openReceive;$('empty-receive').onclick=openReceive;
for(const button of document.querySelectorAll('[data-close]'))button.onclick=()=>$(button.dataset.close).close();
$('refresh').onclick=()=>refresh().catch(error=>notice(error.message));
async function refresh(){const data=await json('/api/state');state.captures=data.captures;state.reviews=data.reviews;renderSidebar();
  if(state.id)await render();else if(state.captures.length){state.id=state.captures[0].id;await render();}}
function renderSidebar(){const nav=$('captures');nav.replaceChildren();for(const capture of state.captures){
  const button=element('button',{class:'capture'+(state.id===capture.id?' active':''),type:'button','aria-pressed':String(state.id===capture.id),onclick:()=>select(capture.id)},[
    element('strong',{text:capture.label}),element('small',{text:'Network '+fmt(capture.summary.context.network)+' · Block '+fmt(capture.summary.context.block)}),
    element('span',{class:'capture-status',text:capture.summary.outcome.status+' · '+capture.createdAt.slice(0,10)})]);nav.append(button);}
  $('capture-count').textContent=state.captures.length+' retained simulation'+(state.captures.length===1?'':'s');}
async function select(id){state.id=id;if(state.other===id)state.other=null;state.offset=0;state.q='';renderSidebar();try{await render();}catch(error){notice(error.message);}}
const panel=(title,body,extra=null)=>element('section',{class:'panel'},[element('div',{class:'panel-head'},[element('h2',{text:title}),extra]),body]);
function contextGrid(context){return element('div',{class:'context-grid'},Object.entries(context).map(([name,value])=>element('div',{class:'context-item'+(name==='input'?' wide':'')},[
  element('label',{text:{network:'EVM network',block:'Observed block',transactionIndex:'Transaction index',from:'Sender',to:'Recipient',input:'Call data',value:'Value (atomic units)',gasLimit:'Gas limit'}[name]??name}),element('code',{text:fmt(value)})])));}
function metric(label,value,detail){return element('div',{class:'metric'},[element('label',{text:label}),element('strong',{text:fmt(value)}),element('small',{text:detail})]);}
async function render(){const generation=++state.generation;const data=await json('/api/captures/'+state.id);let comparison=null;
  if(state.other)comparison=await json('/api/compare?before='+state.id+'&after='+state.other);if(generation!==state.generation)return;
  state.current=data;state.comparison=comparison;const record=data.record,a=data.analysis,main=$('main');main.replaceChildren();
  main.append(element('header',{class:'work-header'},[element('div',{},[element('p',{class:'eyebrow',text:'RETAINED CUSTOMER RESULT'}),element('h1',{text:record.label}),
    element('p',{class:'subline',text:fmt(a.simulationId)+' · Received '+new Date(record.createdAt).toLocaleString()})]),element('div',{class:'actions'},[
      action('Download review',()=>download('/api/download/'+state.id+'/review.html','simulation-review.html')),
      action('Save review',()=>openReview(),'primary')])]));
  const compareSelect=element('select',{'aria-label':'Compare with another simulation',onchange:async event=>{state.other=event.target.value||null;state.offset=0;try{await render();}catch(error){notice(error.message);}}},[
    element('option',{value:'',text:'Select a retained comparison'})]);
  for(const item of state.captures)if(item.id!==state.id)compareSelect.append(element('option',{value:item.id,text:item.label}));compareSelect.value=state.other??'';
  main.append(element('div',{class:'compare-bar'},[element('label',{text:'Compare with'}),compareSelect,
    ...(state.other?[action('Clear comparison',async()=>{state.other=null;state.offset=0;await render();})]:[])]));
  const tabs=element('nav',{class:'tabs','aria-label':'Analysis sections'});for(const [id,label]of [['overview','Overview'],['calls','Calls'],['state','State'],['assets','Assets'],['logs','Logs'],['source','Source & exports'],['reviews','Saved reviews']]){
    const count=Object.hasOwn(a.counts,id)?' '+(comparison?comparison.comparable[id]?comparison.counts[id]:'—':a.availability[id]?a.counts[id]:'—'):'';
    tabs.append(action(label+count,async()=>{state.tab=id;state.offset=0;state.q='';await render();},state.tab===id?'selected':''));}main.append(tabs);
  if(state.tab==='overview')renderOverview(main,a,record,comparison);
  else if(state.tab==='source')renderSources(main,data);
  else if(state.tab==='reviews')renderReviews(main);
  else await renderTable(main,a,generation);
}
function renderOverview(main,a,record,c){
  main.append(element('div',{class:'metrics'},[
    metric('Transaction outcome',a.outcome.status,c?'Comparison: '+c.outcome.after.status:'Saved provider execution'),
    metric('Gas used',a.outcome.gasUsed,c?'Difference (after − before): '+fmt(c.outcome.gasUsedDelta):'Exact integer gas units'),
    metric('Call records',a.availability.calls?a.counts.calls:null,a.traceRepresentation+' provider trace'),
    metric('State changes',a.availability.state?a.counts.state:null,a.counts.failedCalls+' calls with an error') ]));
  if(c){main.append(panel('Execution context',simpleTable(['Field','Before','After','Relation'],c.context.map(row=>[
    row.field,fmt(row.before),fmt(row.after),row.equal===null?'Incomplete context':row.equal?'Same':'Changed']))));
    main.append(element('p',{class:'inline-note',text:'Interpret execution differences together with the selected network, block, transaction index and call data. Call comparisons align structural position and exact call identity.'}));
    main.append(panel('Available records',simpleTable(['Section','Before','After','Differences'],['calls','state','assets','logs'].map(k=>[
      k,c.coverage.before[k]?'Available':'Unavailable',c.coverage.after[k]?'Available':'Unavailable',c.comparable[k]?String(c.counts[k]):'Unavailable']))));
  }else main.append(panel('Execution context',contextGrid(a.context)));
  if(a.outcome.error)main.append(panel('Provider execution error',element('pre',{text:a.outcome.error})));
  if(a.findings.length)main.append(panel('Context observations',element('div',{},a.findings.map(f=>element('div',{class:'finding'},[
    element('strong',{text:f.code.replaceAll('_',' ')}),element('p',{class:'hint',text:JSON.stringify(f)})])))));
  main.append(panel('Original delivery',element('div',{class:'context-grid'},[
    element('div',{class:'context-item'},[element('label',{text:'Received through'}),element('code',{text:record.sourceKind==='NATIVE_BUYER_RESPONSE'?'Original Stellar Forge buyer':'Saved provider response'})]),
    element('div',{class:'context-item'},[element('label',{text:'Original buyer outcome'}),element('code',{text:record.buyer?fmt(record.buyer.status)+' · HTTP '+fmt(record.buyer.httpStatus):'Provider capture'})]),
    element('div',{class:'context-item wide'},[element('label',{text:'Response SHA-256'}),element('code',{text:record.binding.responseSha256})]) ,
    action('Inspect provider object',()=>source(state.id,a.payloadPointer))));
}
function simpleTable(headers,rows){const table=element('table',{},[element('thead',{},[element('tr',{},headers.map(h=>element('th',{text:h})))]),
  element('tbody',{},rows.map(row=>element('tr',{},row.map(value=>element('td',{text:value})))))]);return element('div',{class:'table-wrap'},[table]);}
const columns={calls:['path','type','from','to','method','gasUsed','error'],state:['kind','address','slot','before','after'],
  assets:['kind','type','asset','symbol','amount','amountField'],logs:['index','address','event','topic0']};
async function renderTable(main,a,generation){const category=state.tab;const search=element('input',{type:'search',value:state.q,placeholder:'Search '+category,'aria-label':'Search '+category});
  let timer;search.addEventListener('input',()=>{clearTimeout(timer);timer=setTimeout(async()=>{
    if(generation!==state.generation)return;const caret=search.selectionStart;state.q=search.value;state.offset=0;
    try{await render();const replacement=document.querySelector('input[aria-label="Search '+category+'"]');
      if(replacement&&state.tab===category){replacement.focus();replacement.setSelectionRange(caret,caret);}}
    catch(e){notice(e.message);}},350);});
  const controls=element('div',{class:'table-controls'},[element('div',{class:'table-title'},[element('h2',{text:(state.other?'Changed ':'')+category})]),search]);
  if(!state.other)controls.append(action('Download CSV',()=>download('/api/download/'+state.id+'/'+category+'.csv',category+'.csv')));main.append(controls);
  const query=new URLSearchParams({offset:String(state.offset),limit:'50',q:state.q});let path;
  if(state.other){query.set('before',state.id);query.set('after',state.other);query.set('table',category);path='/api/compare?'+query;}
  else path='/api/captures/'+state.id+'/tables/'+category+'?'+query;
  const data=await json(path);if(generation!==state.generation)return;
  if(!data.rows.length){main.append(element('div',{class:'table-empty',text:!state.other&&!a.availability[category]?
    'The saved provider response omits this record collection.':state.other?!state.comparison.comparable[category]?'Comparison is unavailable because a selected response omits this record collection.':'No matching differences in the selected records.':'No matching records.'}));return;}
  const headers=state.other?['Change','Before','After']:[...columns[category],'Original source'];const tbody=element('tbody');
  for(const row of data.rows){let cells;
    if(state.other)cells=[element('td',{},[element('span',{class:'change',text:row.change})]),...['before','after'].map(side=>{
      const value=row[side],cell=element('td',{class:'split-cell'});if(!value){cell.textContent='—';return cell;}
      cell.append(element('pre',{class:'compare-value',text:columns[category].map(k=>k+': '+short(value[k],110)).join('\n')}),
        action('Original '+side,()=>source(side==='before'?state.id:state.other,value.sourcePointer)));return cell;})];
    else cells=[...columns[category].map(k=>element('td',{},[element('code',{text:short(row[k]),title:short(row[k],300)})])),
      element('td',{},[action('Inspect',()=>source(state.id,row.sourcePointer))])];tbody.append(element('tr',{},cells));}
  main.append(element('div',{class:'table-wrap'},[element('table',{},[element('thead',{},[element('tr',{},headers.map(h=>element('th',{text:h})))]),tbody])]));
  const previous=action('Previous',async()=>{state.offset=Math.max(0,state.offset-50);await render();});previous.disabled=state.offset===0;
  const next=action('Next',async()=>{state.offset+=50;await render();});next.disabled=!data.hasMore;
  main.append(element('div',{class:'pager'},[element('span',{text:(state.offset+1)+'–'+(state.offset+data.rows.length)+' of '+data.total}),previous,next]));
}
async function source(id,pointer){const data=await json('/api/source?'+new URLSearchParams({id,pointer}));
  $('source-pointer').textContent=pointer||'(original response root)';$('source-json').textContent=JSON.stringify(data.value,null,2);$('source-dialog').showModal();}
function renderSources(main,{record,analysis}){
  main.append(panel('Source identities',contextGrid({capture:record.id,responseSha256:record.binding.responseSha256,
    responseBytes:record.binding.responseBytes,simulation:analysis.simulationId,requestSha256:record.binding.requestSha256,
    originalBuyerResultSha256:record.binding.nativeSha256})));
  const descriptions={'response.json':['Original response','Exact bytes received from the provider or original buyer.'],
    'analysis.json':['Analysis data','Full normalized records, exact source pointers and coverage.'],
    'review.html':['Readable review','A standalone report of the retained simulation.'],
    'request.json':['Original request','The network, block, transaction index and public transaction fields.'],
    'buyer-result.json':['Original buyer result','The saved native outcome and response-file metadata.']};
  const grid=element('div',{class:'download-grid'});for(const [file,[title,description]]of Object.entries(descriptions)){
    if(file==='request.json'&&!record.binding.requestSha256||file==='buyer-result.json'&&!record.binding.nativeSha256)continue;
    grid.append(element('div',{class:'download-item'},[element('div',{},[element('strong',{text:title}),element('p',{text:description})]),action('Download',()=>download('/api/download/'+state.id+'/'+file,file))]));}
  main.append(grid,element('p',{class:'inline-note',text:'Use the command-line export action for one complete private directory containing the original inputs, analysis, four CSV tables, readable review and file manifest.'}));
}
function openReview(){$('review-title').value=state.current.record.label+(state.other?' comparison':' review');$('review-notes').value='';
  $('review-selection').textContent=state.other?'Save the selected before and after results with these notes.':'Save the selected result with these notes.';$('review-dialog').showModal();}
function renderReviews(main){const selected=state.reviews.filter(r=>r.beforeId===state.id||r.afterId===state.id);
  if(!selected.length){main.append(element('div',{class:'table-empty',text:'Save a review to keep notes attached to these exact results.'}));return;}
  const list=element('div',{class:'reviews'});for(const review of selected)list.append(element('article',{class:'review-card'},[
    element('h2',{text:review.title||'Simulation review'}),element('p',{class:'review-note',text:review.notes||'No additional notes.'}),
    element('div',{class:'actions'},[action('Download review',()=>download('/api/reviews/'+review.id+'/review.html','simulation-review.html')),
      action('Download review JSON',()=>download('/api/reviews/'+review.id+'/review.json','simulation-review.json'))])]));main.append(list);}
$('receive-form').addEventListener('submit',async event=>{event.preventDefault();const form=event.currentTarget,button=$('receive-submit');button.disabled=true;
  try{notice('');const data=await json('/api/receive',{method:'POST',body:new FormData(form)});$('receive-dialog').close();
    form.reset();state.id=data.record.id;state.other=null;state.tab='overview';await refresh();}
  catch(error){notice(error.message);}finally{button.disabled=false;}});
$('review-form').addEventListener('submit',async event=>{event.preventDefault();const button=event.currentTarget.querySelector('[type=submit]');button.disabled=true;
  try{notice('');await json('/api/reviews',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({beforeId:state.id,afterId:state.other,
    title:$('review-title').value,notes:$('review-notes').value})});$('review-dialog').close();state.tab='reviews';await refresh();}
  catch(error){notice(error.message);}finally{button.disabled=false;}});
refresh().catch(error=>notice(error.message==='AUTH_REQUIRED'?'Open the private workspace URL printed by the analysis command.':error.message));
