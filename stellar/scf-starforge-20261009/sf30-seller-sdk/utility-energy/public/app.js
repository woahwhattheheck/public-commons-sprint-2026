'use strict';
// MIT. Complete private utility operator; every action uses the original workspace.
const $=id=>document.getElementById(id);
const token=location.hash.slice(1)||sessionStorage.getItem('utility-capability')||'';
if(location.hash){sessionStorage.setItem('utility-capability',token);history.replaceState({},'',location.pathname);}
let state=null,preview=null,recordOffset=0,recordNext=null,queryContinuation=null,queryInitial=null;
let changeId=null,changeOffset=0,changeNext=null;
const activeCaptures=new Set();
const text=value=>value===null||value===undefined?'':typeof value==='object'?JSON.stringify(value):String(value);
const pretty=value=>JSON.stringify(value,null,2);
const short=value=>typeof value==='string'&&value.length>28?value.slice(0,16)+'…'+value.slice(-8):text(value);
const list=value=>Array.isArray(value)?value:[];
function node(tag,value,className){const n=document.createElement(tag);if(value!==undefined)n.textContent=text(value);if(className)n.className=className;return n;}
function status(message,error=false){$('status').textContent=message;$('status').dataset.error=String(error);}
function button(label,fn,small=true){const b=node('button',label,small?'small':'');b.type='button';b.addEventListener('click',()=>run(fn));return b;}
function show(value,title='Original source detail'){$('inspect-title').textContent=title;$('inspect-content').textContent=pretty(value);$('inspect-dialog').showModal();}
async function run(fn){
  try{status('Working…');const result=await fn();status('Workspace updated.');return result;}
  catch(error){status(error.message||String(error),true);return undefined;}
}
async function request(path,options={}){
  const response=await fetch(path,{...options,headers:{Authorization:'Bearer '+token,...options.headers}});
  if(!response.ok){let message='Local operation returned '+response.status;try{const body=await response.json();message=body.error||message;}catch{}throw new Error(message);}
  return response;
}
async function get(path,params={}){
  const query=new URLSearchParams(Object.entries(params).filter(([,v])=>v!==undefined&&v!==null));
  return(await request(path+(query.size?'?'+query:''))).json();
}
async function act(action,payload){
  const requestId=crypto.randomUUID();
  try{
    const result=await(await request('/api/action',{method:'POST',headers:{'Content-Type':'application/json'},
      body:JSON.stringify({action,payload,expected_revision:state.revision,request_id:requestId})})).json();
    state=result.state;renderState();return result.result;
  }catch(error){error.message+=' · Request '+requestId;throw error;}
}
async function refresh(){state=await get('/api/state');renderState();}
async function download(path,params,filename,expected){
  const query=new URLSearchParams(params||{});const response=await request(path+(query.size?'?'+query:''));
  const data=await response.arrayBuffer();
  if(expected){
    const digest=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',data)),x=>x.toString(16).padStart(2,'0')).join('');
    if(data.byteLength!==expected.bytes||digest!==expected.sha256)throw new Error('The received file differs from its retained delivery identity.');
  }
  const url=URL.createObjectURL(new Blob([data],{type:response.headers.get('Content-Type')||'application/octet-stream'}));
  const a=node('a');a.href=url;a.download=filename;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),30000);
}
function table(target,rows,columns){
  target=typeof target==='string'?$(target):target;target.replaceChildren();
  if(!rows.length){target.append(node('div','No retained records for this selection.','empty'));return;}
  const wrap=node('div',undefined,'table-wrap'),t=node('table'),head=node('thead'),tr=node('tr');
  for(const column of columns)tr.append(node('th',column.label));
  head.append(tr);t.append(head);const body=node('tbody');
  for(const row of rows){const line=node('tr');for(const column of columns){
    const cell=node('td');const value=column.render?column.render(row):row[column.key];
    if(value instanceof Node)cell.append(value);else cell.textContent=text(value);
    if(column.className)cell.className=column.className;line.append(cell);
  }body.append(line);}
  t.append(body);wrap.append(t);target.append(wrap);
}
function actions(...buttons){const n=node('div',undefined,'toolbar');n.append(...buttons);return n;}
function options(id,rows,valueKey,labelFn,preferred){
  const select=$(id),previous=select.value||preferred;
  select.replaceChildren(...rows.map(row=>{const option=node('option',labelFn(row));option.value=row[valueKey];return option;}));
  if([...select.options].some(x=>x.value===previous))select.value=previous;
}
function checkChoices(id,rows,labelFn,defaultFn){
  const target=$(id),was=target.children.length>0,checked=new Set([...target.querySelectorAll('input:checked')].map(x=>x.value));
  target.replaceChildren(...rows.map(row=>{const label=node('label'),input=node('input');input.type='checkbox';input.value=row.id||row.series_id;
    input.checked=was?checked.has(input.value):Boolean(defaultFn?.(row));
    label.append(input,node('span',labelFn(row)));return label;}));
}
function selected(id){return[...$(id).querySelectorAll('input:checked')].map(x=>x.value);}
function renderState(){
  $('revision').textContent='Revision '+state.revision;
  $('totals').replaceChildren(...Object.entries(state.totals||{}).map(([key,value])=>{const n=node('div',undefined,'metric');n.append(node('strong',value),node('span',key+' records'));return n;}));
  const imports=state.imports||[];
  table('imports',imports,[{label:'Source',key:'name'},{label:'Provider',key:'provider'},{label:'Resource',key:'kind'},
    {label:'Records',render:r=>Object.entries(r.counts).filter(([,v])=>v).map(([k,v])=>v+' '+k).join(', ')},
    {label:'Bytes',key:'bytes'},{label:'Received',key:'created_at'},
    {label:'Open',className:'actions',render:r=>actions(button('Inspect',async()=>show(await get('/api/import',{id:r.id}),r.name)),
      button('Original',()=>download('/api/original',{id:r.id},r.source_sha256+(r.provider==='greenbutton'?'.xml':'.json'))))}]);
  checkChoices('review-imports',imports,r=>r.name+' · '+r.provider+' · '+Object.entries(r.counts).filter(([,v])=>v).map(([k,v])=>v+' '+k).join(', '),r=>r.counts.intervals>0||r.counts.bills>0);
  const priority=$('review-priority'),before=new Set([...priority.selectedOptions].map(x=>x.value));
  const originalOrder=[...priority.options].map(option=>option.value),byId=new Map(imports.map(item=>[item.id,item]));
  const ordered=[...originalOrder.filter(id=>byId.has(id)),...imports.map(item=>item.id).filter(id=>!originalOrder.includes(id))];
  priority.replaceChildren(...ordered.map(id=>{const r=byId.get(id),o=node('option',r.name);o.value=id;o.selected=before.has(id);return o;}));
  const reviews=state.reviews||[],builds=state.builds||[],exports=state.exports||[];
  for(const id of ['build-review','bill-review'])options(id,reviews,'id',r=>r.name+' · '+r.reviewer,state.active_review);
  options('export-review',reviews.filter(r=>r.build_id),'id',r=>r.name+' · '+short(r.build_id),state.active_review);
  for(const id of ['query-build','compare-before','compare-after'])options(id,builds,'id',r=>short(r.id)+' · '+r.rowCount+' rows',state.active_build);
  options('publisher-export',exports,'id',r=>short(r.id)+' · '+r.files.length+' files');
  table('reviews',reviews,[{label:'Review',key:'name'},{label:'Reviewer',key:'reviewer'},{label:'Decision',key:'note'},{label:'Saved',key:'created_at'},
    {label:'Open',render:r=>actions(button('Read',async()=>{const v=await get('/api/review',{id:r.id});show(v,r.name);}),
      button('Analysis',async()=>loadPreview(await get('/api/preview',{id:r.preview_id}))))}]);
  table('builds',builds,[{label:'Edition',render:r=>short(r.id)},{label:'Rows',key:'rowCount'},{label:'Snapshot',render:r=>short(r.native?.snapshot)},
    {label:'Open',render:r=>actions(button('Inspect',async()=>show(await get('/api/build',{id:r.id}),'Native dataset')),
      button('Native packet',()=>download('/api/native-project',{id:r.id},'native-project.zip')))}]);
  table('comparisons',state.comparisons||[],[{label:'Before',render:r=>short(r.before)},{label:'After',render:r=>short(r.after)},
    {label:'Changes',key:'counts'},{label:'Open',render:r=>actions(button('Read changes',async()=>{changeId=r.id;changeOffset=0;await loadChanges();}),
      button('Download',()=>download('/api/changes/download',{id:r.id},'utility-edition-changes.ndjson')))}]);
  table('reconciliations',state.reconciliations||[],[{label:'Review',render:r=>short(r.review_id)},{label:'Bills',key:'bill_count'},
    {label:'Saved',key:'created_at'},{label:'Open',render:r=>button('Inspect',async()=>showBills(await get('/api/reconciliation',{id:r.id})))}]);
  table('exports',exports,[{label:'Delivery',render:r=>short(r.id)},{label:'Files',render:r=>r.files.length},{label:'Bytes',key:'bytes'},
    {label:'Created',key:'created_at'},{label:'Open',render:r=>actions(button('Files',()=>showExport(r.id)),
      button('Download all',()=>download('/api/export-zip',{id:r.id},'utility-customer-delivery.zip')))}]);
  table('captures',state.captures||[],[{label:'Collection',key:'name'},{label:'State',key:'status'},
    {label:'Pages',render:r=>r.pages.length},{label:'Remaining',render:r=>r.pending.length},
    {label:'Continue',render:r=>actions(button('Inspect',()=>show(r,r.name)),button('Continue',()=>collect(r.id)),
      button('Pause',async()=>{activeCaptures.delete(r.id);await act('capture.pause',{capture_id:r.id});}))}]);
  if(state.merchant&&!$('merchant-payment').value){
    $('merchant-payment').value=pretty(state.merchant.payment);$('merchant-origin').value=state.merchant.origin;$('merchant-path').value=state.merchant.path;
  }
}
async function upload(file,restore=false){
  const headers={'X-Utility-Request-Id':crypto.randomUUID(),'X-Utility-Revision':String(state.revision)};
  if(!restore){headers['X-Utility-Name']=encodeURIComponent(file.name);headers['X-Utility-Provider']=$('import-provider').value;headers['X-Utility-Kind']=$('import-kind').value;
    if($('import-reference').value.trim())headers['X-Utility-Context']=encodeURIComponent(JSON.stringify({reference:$('import-reference').value.trim()}));}
  const result=await(await request(restore?'/api/restore':'/api/upload',{method:'POST',headers,body:file})).json();
  state=result.state;renderState();return result.result;
}
async function browse(){
  const r=await get('/api/records',{kind:$('browse-kind').value,meter:$('browse-meter').value.trim()||undefined,offset:recordOffset,limit:100});
  recordNext=r.next_offset;
  const keys={interval:['meter_id','channel','start_utc','end_utc','value_raw','unit','energy_kwh','quality'],
    meter:['meter_id','status','service_identifier','service_address','service_tariff'],
    bill:['meter_id','start_utc','end_utc','volume_raw','unit','cost_raw','currency'],
    charge:['meter_id','section','name','volume_raw','unit','cost_raw'],
    resource:['meter_id','resource_type','resource_id','issues']}[$('browse-kind').value];
  table('records',r.rows,[...keys.map(key=>({label:key.replaceAll('_',' '),key})),
    {label:'Source',render:row=>button('Inspect',async()=>{$('record-detail').textContent=pretty(await get('/api/record',{id:row.row_id}));$('record-detail').parentElement.open=true;})}]);
  $('records-count').textContent=(r.total?recordOffset+1:0)+'–'+(recordOffset+r.rows.length)+' of '+r.total;
  $('records-prev').disabled=recordOffset===0;$('records-next').disabled=recordNext===null;
}
async function readSeries(){
  const r=await get('/api/series',{imports:selected('review-imports').join(',')});
  checkChoices('review-series',r.series,row=>row.meter_id+' · '+row.channel+' · '+row.unit+' · '+row.records+' source readings',()=>true);
}
function movePriority(direction){
  const select=$('review-priority');
  if(direction<0){
    for(let i=1;i<select.options.length;i++)if(select.options[i].selected&&!select.options[i-1].selected)
      select.insertBefore(select.options[i],select.options[i-1]);
  }else{
    for(let i=select.options.length-2;i>=0;i--)if(select.options[i].selected&&!select.options[i+1].selected)
      select.insertBefore(select.options[i+1],select.options[i]);
  }
}
function reviewSelection(){
  return{name:$('review-name').value.trim(),import_ids:selected('review-imports'),
    series_ids:selected('review-series'),timezone:$('review-zone').value.trim()||'source',
    start:$('review-start').value.trim()||null,end:$('review-end').value.trim()||null,
    preferred_import_ids:[...$('review-priority').selectedOptions].map(x=>x.value),
    overlap_strategy:$('review-overlap').value,exclude_rows:JSON.parse($('review-exclusions').value||'[]'),
    choose_rows:JSON.parse($('review-choices').value||'{}')};
}
function loadPreview(value){
  preview=value;const report=value.report;const container=$('review-report');container.replaceChildren();
  const metrics=node('div',undefined,'metrics');
  for(const [label,n] of [['Selected readings',report.selected_rows],['Source readings',report.input_rows],
    ['Conflicts',report.conflicts.length],['Exceptions',report.issues.length]]){
    const ndiv=node('div',undefined,'metric');ndiv.append(node('strong',n),node('span',label));metrics.append(ndiv);
  }
  container.append(metrics,node('p',report.can_build?'The selected intervals can be built as a native dataset.':'Choose the conflicting original readings and valid periods before building.'));
  const summary=node('div');table(summary,report.series,[{label:'Meter',key:'meter_id'},{label:'Channel',key:'channel'},{label:'Rows',key:'rows'},
    {label:'Duration counts, seconds',key:'durations'},{label:'Observed kWh',key:'observed_energy_kwh'},
    {label:'Gaps',render:r=>r.coverage.gaps.length},{label:'Overlaps',render:r=>r.coverage.overlap_groups.length},
    {label:'Quality',key:'qualities'}]);container.append(summary);
  for(const series of report.series){
    const details=node('details'),title=node('summary',series.meter_id+' · '+series.channel+' · local dates and coverage');details.append(title);
    const daily=node('div');table(daily,series.daily,[{label:'Local date',key:'date'},{label:'Readings',key:'rows'},{label:'Observed kWh',key:'energy_kwh'}]);
    details.append(daily,node('pre',pretty({coverage:series.coverage,reading_type:series.reading_type,
      partial_window_rows:series.partial_window_rows,crosses_local_day:series.crosses_local_day})));container.append(details);
  }
  if(report.issues.length){const ul=node('ul',undefined,'issue-list');for(const issue of report.issues)ul.append(node('li',issue.code+' · '+issue.message));container.append(ul);}
  $('review-json').textContent=pretty(report);
  const corrections=$('corrections');corrections.replaceChildren();
  for(const conflict of report.conflicts){
    const section=node('div',undefined,'correction');section.append(node('h3','Conflicting interval '+short(conflict.logical_key)));
    const pre=node('pre',pretty(conflict));section.append(pre);
    const choice=node('select'),empty=node('option','Choose an original reading');empty.value='';choice.append(empty);
    const ids=list(conflict.row_ids||conflict.candidates?.map(r=>r.row_id));
    for(const id of ids){const option=node('option',id);option.value=id;choice.append(option);}
    choice.addEventListener('change',()=>{const choices=JSON.parse($('review-choices').value||'{}');if(choice.value)choices[conflict.logical_key]=choice.value;else delete choices[conflict.logical_key];$('review-choices').value=pretty(choices);});
    section.append(choice);corrections.append(section);
  }
}
function showBills(value){
  $('bill-json').textContent=pretty(value);table('bill-result',value.report.bills,
    [{label:'Meter',key:'meter_id'},{label:'Bill',key:'bill_id'},{label:'Period start',key:'start'},{label:'Period end',key:'end'},
     {label:'Coverage',key:'status'},{label:'Observed kWh',key:'observed_energy_kwh'},{label:'Billed kWh',key:'billed_energy_kwh'},
     {label:'Difference kWh',key:'energy_difference_kwh'},{label:'Bill cost',key:'bill_cost'},
     {label:'Detail',render:r=>button('Inspect',()=>show(r,'Original bill reconciliation'))}]);
}
function queryBody(result){
  let value=result.response?.body??result.body??result;
  if(typeof value==='string'){try{return JSON.parse(value);}catch{return{body:value};}}return value;
}
async function query(params){
  const result=await act('dataset.query',{build_id:$('query-build').value,query:params}),body=queryBody(result);
  $('query-json').textContent=pretty(result);
  const rows=Array.isArray(body)?body:list(body.rows||body.data);
  const keys=rows.length?Object.keys(rows[0]):[];
  table('query-result',rows,keys.map(key=>({label:key.replaceAll('_',' '),key})));
  queryContinuation=body.page?.nextCursor??null;$('query-next').disabled=!queryContinuation;
}
async function loadChanges(){
  const result=await get('/api/changes',{id:changeId,offset:changeOffset,limit:100});
  const rows=result.changes||result.rows||[];
  table('changes',rows,[{label:'Change',key:'kind'},{label:'Interval key',key:'key'},{label:'Fields',key:'fields'},
    {label:'Values',render:r=>button('Inspect',()=>show(r,'Original edition change'))}]);
  changeNext=result.nextOffset??result.next_offset??(rows.length===100?changeOffset+100:null);$('changes-next').disabled=changeNext===null;
}
async function showExport(id){
  const result=await get('/api/export',{id});
  table('export-files',result.files,[{label:'File',key:'name'},{label:'Bytes',key:'bytes'},{label:'SHA256',key:'sha256'},
    {label:'Download',render:r=>button('Download',()=>download('/api/export-file',{id,name:r.name},r.name.split('/').at(-1),r))}]);
}
async function collect(id){
  if(activeCaptures.has(id))return;
  activeCaptures.add(id);
  try{
    let current=await get('/api/capture',{id});
    if(current.status==='paused'||current.status==='attention')current=await act('capture.resume',{capture_id:id});
    while(activeCaptures.has(id)&&['running','waiting'].includes(current.status)){
      if(current.status==='waiting'&&current.retry_at){
        const delay=new Date(current.retry_at).getTime()-Date.now();
        if(delay>0){status('UtilityAPI collection will resume at '+current.retry_at+'.');await new Promise(resolve=>setTimeout(resolve,Math.min(delay,30000)));current=await get('/api/capture',{id});continue;}
      }
      current=await act('capture.advance',{capture_id:id});
      status(current.name+' · '+current.status+' · '+current.pages.length+' original responses');
    }
  }finally{activeCaptures.delete(id);}
}
async function readPublisher(){
  const result=await get('/api/publisher-state');$('publisher-state').textContent=pretty(result);return result;
}
function form(id,fn){$(id).addEventListener('submit',event=>{event.preventDefault();run(fn);});}
for(const item of document.querySelectorAll('[data-page]'))item.addEventListener('click',()=>{
  for(const section of document.querySelectorAll('main>section'))section.hidden=section.id!=='page-'+item.dataset.page;
  for(const other of document.querySelectorAll('[data-page]')){if(other===item)other.setAttribute('aria-current','page');else other.removeAttribute('aria-current');}
});
$('refresh').onclick=()=>run(refresh);
$('portable').onclick=()=>run(()=>download('/api/portable',{},'utility-workspace.zip'));
$('inspect-close').onclick=()=>$('inspect-dialog').close();
$('series-refresh').onclick=()=>run(readSeries);
$('priority-up').onclick=()=>movePriority(-1);
$('priority-down').onclick=()=>movePriority(1);
form('import-form',async()=>{for(const file of $('import-files').files){status('Receiving '+file.name+'…');await upload(file);}await browse();});
form('capture-form',async()=>{const current=await act('capture.start',{name:$('capture-name').value.trim(),
  token_env:$('capture-env').value.trim(),meter_ids:$('capture-meters').value.split(',').map(x=>x.trim()).filter(Boolean),
  start:$('capture-start').value.trim()||null,end:$('capture-end').value.trim()||null});await collect(current.id);});
form('browse-form',async()=>{recordOffset=0;await browse();});
$('records-prev').onclick=()=>run(async()=>{recordOffset=Math.max(0,recordOffset-100);await browse();});
$('records-next').onclick=()=>run(async()=>{if(recordNext!==null){recordOffset=recordNext;await browse();}});
form('review-form',async()=>loadPreview(await act('analysis.preview',reviewSelection())));
form('save-review-form',async()=>{if(!preview)throw new Error('Analyze the selected intervals first.');
  await act('review.save',{preview_id:preview.id,expected_sha256:preview.report.sha256,reviewer:$('reviewer').value.trim(),
    note:$('review-note').value.trim(),acknowledged_issue_ids:$('ack-issues').checked?preview.report.issues.map(x=>x.id):[]});});
form('build-form',async()=>{const result=await act('edition.build',{review_id:$('build-review').value});$('query-build').value=result.id;});
form('query-form',async()=>{queryInitial=JSON.parse($('query-params').value);await query(queryInitial);});
$('query-next').onclick=()=>run(async()=>{if(queryContinuation)await query({...queryInitial,cursor:queryContinuation});});
form('compare-form',async()=>{const result=await act('edition.compare',{before_id:$('compare-before').value,after_id:$('compare-after').value});changeId=result.id;changeOffset=0;await loadChanges();});
$('changes-next').onclick=()=>run(async()=>{if(changeNext!==null){changeOffset=changeNext;await loadChanges();}});
form('reconcile-form',async()=>showBills(await act('bills.reconcile',{review_id:$('bill-review').value,bill_series:JSON.parse($('bill-links').value||'{}')})));
form('export-form',async()=>{const result=await act('package.export',{review_id:$('export-review').value});await showExport(result.id);});
form('restore-form',async()=>{const file=$('restore-file').files[0];if(!file)throw new Error('Choose the original utility workspace ZIP.');await upload(file,true);await browse();});
form('merchant-form',async()=>{await act('merchant.configure',{payment:JSON.parse($('merchant-payment').value),origin:$('merchant-origin').value.trim(),path:$('merchant-path').value.trim()});});
form('publisher-prepare-form',async()=>{const result=await act('publisher.prepare',{export_id:$('publisher-export').value});$('publisher-result').textContent=pretty(result);await readPublisher();});
$('publisher-refresh').onclick=()=>run(readPublisher);
form('publisher-action-form',async()=>{const result=await act($('publisher-action').value,JSON.parse($('publisher-payload').value));$('publisher-result').textContent=pretty(result);await readPublisher();});
$('publisher-action').onchange=()=>{const action=$('publisher-action').value;
  const template=action==='publisher.preview'?{target:'',query:'limit=100'}:
    ['publisher.reviewDraft','publisher.publish'].includes(action)?{draftId:'',expectedSnapshot:'',expectedRevision:1}:
    action==='publisher.activateSnapshot'?{snapshot:'',expectedSnapshot:'',expectedRevision:1}:
    action==='publisher.release.stage'?{draftId:'',id:'',label:'',runtime:{port:0}}:
    action==='publisher.release.inspect'?{id:''}:
    action==='publisher.release.activate'?{id:'',expectedGeneration:0}:
    ['publisher.release.start','publisher.release.rollback'].includes(action)?{expectedGeneration:0}:{};
  $('publisher-payload').value=pretty(template);
};
$('operations-refresh').onclick=()=>run(async()=>{const result=await get('/api/operations');table('operations',result.operations.slice().reverse(),
  [{label:'Operation',key:'action'},{label:'Status',key:'status'},{label:'Started',key:'started_at'},{label:'Completed',key:'completed_at'},
   {label:'Inspect',render:r=>button('Read',async()=>{$('operation-detail').textContent=pretty(await get('/api/operation',{id:r.request_id}));})}]);});
run(async()=>{if(!token)throw new Error('Open the private local URL printed by the utility workspace process.');await refresh();await browse();
  if(state.active_review){const review=await get('/api/review',{id:state.active_review});loadPreview(await get('/api/preview',{id:review.preview_id}));}});
