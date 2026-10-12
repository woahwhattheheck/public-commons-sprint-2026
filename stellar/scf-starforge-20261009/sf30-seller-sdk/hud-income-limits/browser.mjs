// MIT. Industrial operator workflow over the original retained HUD application.
const $=id=>document.getElementById(id);
const fragment=new URLSearchParams(location.hash.slice(1));
let token=fragment.get('session')??sessionStorage.getItem('hud-session')??'';
if(fragment.has('session')){sessionStorage.setItem('hud-session',token);history.replaceState(null,'',location.pathname);}
const state={status:null,plan:null,run:null,detail:null,offer:null,buyer:null,busy:false,offset:0,historyOffset:0,search:''};
const short=value=>value?value.slice(0,14)+'…':'—';
const node=(tag,text='',attrs={})=>{const element=document.createElement(tag);element.textContent=text;for(const[k,v]of Object.entries(attrs))element.setAttribute(k,v);return element;};
function notice(message){$('notice').hidden=!message;$('notice').textContent=message??'';}
async function api(path,input){
  const response=await fetch(path,{headers:{authorization:'Bearer '+token,...(input===undefined?{}:{'content-type':'application/json'})},
    ...(input===undefined?{}:{method:'POST',body:JSON.stringify(input)})});
  const value=await response.json();
  if(!response.ok){if(response.status===403)$('session-panel').hidden=false;throw new Error(value.message??value.error);}
  return value;
}
async function action(callback){
  if(state.busy)return;state.busy=true;notice('');buttons();
  try{await callback();}catch(error){notice(error.message);}finally{state.busy=false;buttons();}
}
function buttons(){
  const busy=state.busy||Boolean(state.status?.busy)||Boolean(state.status?.publisher?.active);
  $('extract').disabled=busy||!state.plan;$('publish').disabled=busy||!state.detail?.run.data.review||!['REVIEWED','PUBLICATION_UNKNOWN'].includes(state.detail.run.state);
  $('cancel').hidden=state.status?.publisher?.active?.kind!=='extraction';
  $('recover').disabled=busy||!state.run;
  $('merchant-start').disabled=busy||!state.status?.merchant.configured||state.status?.merchant.running;
  $('merchant-stop').disabled=busy||!state.status?.merchant.running;
  for(const form of ['acquire-form','selection-form','plan-form','review-form','merchant-form','buyer-form'])
    $(form).querySelector('button').disabled=busy;
  $('export-selection').disabled=state.busy||!state.status?.selectedRelease;
  $('import-capture').disabled=busy;$('import-packet').disabled=busy;
  $('export-packet').disabled=state.busy||!state.status?.selectedRelease;
  $('download-buyer').disabled=!state.buyer;
}
function switchPanel(name){
  for(const element of document.querySelectorAll('[data-view]'))element.hidden=element.dataset.view!==name;
  for(const element of document.querySelectorAll('[data-panel]'))element.classList.toggle('selected',element.dataset.panel===name);
}
for(const button of document.querySelectorAll('[data-panel]'))button.addEventListener('click',()=>switchPanel(button.dataset.panel));
function metadata(){
  return {fiscalYear:Number($('fiscal-year').value),effectiveDate:$('effective-date').value,reviewer:$('release-reviewer').value,note:$('release-note').value};
}
function inputSelection(){
  return Object.fromEntries([['states','states'],['counties','counties'],['localities','localities'],['areas','areas'],['metrics','metrics'],['familySizes','family-sizes']].map(([key,id])=>[key,$(id).value]));
}
function download(value,name,type='application/json'){
  const raw=typeof value==='string'?value:JSON.stringify(value,null,2)+'\n';
  const url=URL.createObjectURL(new Blob([raw],{type})),link=node('a','',{href:url,download:name});
  document.body.append(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),30000);
}
function selectOptions(id,releases,chosen){
  const input=$(id),previous=chosen??input.value;input.replaceChildren();
  for(const release of releases)input.append(node('option','FY '+release.fiscalYear+' · '+release.effectiveDate+' · '+short(release.releaseId),{value:release.releaseId}));
  if([...input.options].some(option=>option.value===previous))input.value=previous;
}
function renderStatus(first=false){
  const status=state.status,selected=status.releases.find(item=>item.releaseId===status.selectedRelease);
  $('activity').textContent=status.busy?'Working: '+status.busy.kind+' · '+JSON.stringify(status.busy.progress??{}):
    status.publisher?.active?'Publisher: '+status.publisher.active.kind+' · '+(status.publisher.active.progress.rows??0)+' rows':
    'Retained workspace · revision '+status.revision+(selected?' · FY '+selected.fiscalYear+' · '+selected.effectiveDate:' · acquire a release');
  $('releases').replaceChildren();
  for(const release of [...status.releases].reverse()){
    const card=node('div','',{class:'release-card'});
    card.append(node('strong','FY '+release.fiscalYear+' · effective '+release.effectiveDate),
      node('p',release.localities.toLocaleString()+' localities · '+release.counties.toLocaleString()+' counties · '+release.hudAreas.toLocaleString()+' HUD areas'),
      node('p','Workbook '+release.workbookSha256,{class:'muted'}));
    const buttons=node('div','',{class:'actions'});
    for(const [role,label]of [['workbook','Workbook'],['areas','Area definitions'],['methodology','Methodology'],['index','Source index']]){
      const button=node('button',label,{type:'button'});
      button.addEventListener('click',()=>action(async()=>{
        const response=await fetch('/api/source-file?releaseId='+release.releaseId+'&role='+role,{headers:{authorization:'Bearer '+token}});
        if(!response.ok){const error=await response.json();throw new Error(error.message??error.error);}
        const blob=await response.blob(),url=URL.createObjectURL(blob),a=node('a','',{href:url,download:release.sourceDocuments[role].name});
        document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),30000);
      }));
      buttons.append(button);
    }
    card.append(buttons);$('releases').append(card);
  }
  if(!status.releases.length)$('releases').append(node('p','No retained releases yet.'));
  for(const id of ['selected-release','compare-before','compare-after'])selectOptions(id,status.releases,id==='selected-release'&&first?status.selectedRelease:undefined);
  if(first){
    for(const [key,id]of [['states','states'],['counties','counties'],['localities','localities'],['areas','areas'],['metrics','metrics'],['familySizes','family-sizes']])
      $(id).value=status.selection[key].join(',');
  }
  $('selection-summary').replaceChildren(node('p',selected?'FY '+selected.fiscalYear+' effective '+selected.effectiveDate:'Choose a complete release.'),
    node('p','Original workbook cells remain attached to every observation. Median family income has no family-size value. Published ELI, very low and low income limits use sizes 1–8.'),
    node('p','Different HUD localities within a county remain separate published observations.',{class:'muted'}));
  $('publication-source').textContent=selected?'FY '+selected.fiscalYear+' · '+selected.effectiveDate+' · source '+short(selected.releaseId):'Retain and select a release first.';
  const runs=status.publisher?.runs??[],before=state.run;$('run-select').replaceChildren();
  for(const run of runs)$('run-select').append(node('option',run.state+' · plan '+run.plan+' · '+short(run.id),{value:run.id}));
  if(before&&runs.some(run=>run.id===before))$('run-select').value=before;
  if(!state.run&&runs.length)state.run=runs[0].id;
  const matchingPlan=plan=>plan.data.releaseId===status.selectedRelease&&JSON.stringify(plan.data.input)===JSON.stringify(status.selection);
  if(state.plan&&!status.publisher?.plans.some(plan=>plan.id===state.plan&&matchingPlan(plan)))state.plan=null;
  if(!state.plan&&first)state.plan=status.publisher?.plans.find(matchingPlan)?.id??null;
  $('plan-status').textContent=state.plan?'Saved plan '+state.plan:'Save a selection-bound publication plan.';
  const target=status.target;
  $('target-status').textContent=target?.connected?'Original seller running · revision '+target.versions.revision+' · '+short(target.versions.current):
    target?.initializable?'This reviewed publication will initialize the dataset version store.':'Start the configured original seller to publish another edition.';
  $('merchant-status').textContent=JSON.stringify(status.merchant,null,2);
  $('versions').replaceChildren();
  for(const version of target?.versions?.versions??[]){
    const row=node('div','',{class:'version-row'});
    row.append(node('span',short(version.snapshot)+(version.snapshot===target.versions.current?' · active':'')+' · '+(version.rowCount??'')+' rows'));
    const button=node('button','Activate this retained version',{type:'button'});button.disabled=version.snapshot===target.versions.current;
    button.addEventListener('click',()=>action(async()=>{
      await api('/api/activate',{snapshot:version.snapshot,expectedSnapshot:target.versions.current,expectedRevision:target.versions.revision});
      await refresh();notice('The original dataset controller activated the selected retained version.');
    }));row.append(button);$('versions').append(row);
  }
  $('publisher-history').replaceChildren();
  for(const event of status.publisher?.history??[])$('publisher-history').append(node('div',event.created+' · '+event.kind+(event.run?' · '+short(event.run):''),{class:'history-row'}));
  $('older-history').disabled=status.publisher?.pages?.history?.next===null||!status.publisher;
  $('incomplete').replaceChildren();
  for(const name of status.unfinishedImports){
    const row=node('div','Interrupted intake '+short(name),{class:'release-card'}),button=node('button','Discard this incomplete intake',{type:'button'});
    button.addEventListener('click',()=>action(async()=>{await api('/api/import/discard',{name});await refresh();}));row.append(button);$('incomplete').append(row);
  }
  buttons();
}
async function refresh(first=false){
  state.status=await api('/api/status?historyOffset='+state.historyOffset);
  $('session-panel').hidden=true;renderStatus(first);
}
function table(container,fields,rows){
  const target=$(container);target.replaceChildren();
  if(!rows.length){target.append(node('p','No matching rows.'));return;}
  const table=node('table'),thead=node('thead'),head=node('tr'),body=node('tbody');
  for(const field of fields)head.append(node('th',field));thead.append(head);table.append(thead);
  for(const item of rows){const row=node('tr');for(const field of fields)row.append(node('td',item[field]===null?'—':String(item[field]??'')));body.append(row);}
  table.append(body);target.append(table);
}
async function browse(offset=0){
  const result=await api('/api/localities',{offset,limit:20,search:state.search});
  state.offset=offset;$('locality-count').textContent=result.total.toLocaleString()+' matching localities · selection '+short(result.selectionHash);
  const rows=result.localities.flatMap(item=>item.observations);
  table('locality-table',['county_fips','locality_id','locality_name','hud_area_code','metric','family_size','published_income_usd','source_cell'],rows);
  $('locality-pages').replaceChildren();
  for(const [label,next]of [['Previous',offset?Math.max(0,offset-20):null],['Next',result.next]]){
    const button=node('button',label,{type:'button'});button.disabled=next===null;button.addEventListener('click',()=>action(()=>browse(next)));
    $('locality-pages').append(button);
  }
}
async function loadRun(query){
  if(!state.run)return;
  state.detail=await api('/api/run?id='+encodeURIComponent(state.run)+(query?'&query='+encodeURIComponent(query):''));
  const run=state.detail.run,manifest=run.data.candidate;
  $('run-summary').textContent=run.state+(manifest?' · '+manifest.dataset.rowCount+' observations · '+short(manifest.dataset.snapshot):'')+
    (run.data.error?' · '+run.data.error:'');
  $('review-status').textContent=run.data.review?'Reviewed by '+run.data.review.reviewer+' · '+run.data.review.note:'Record the review against the displayed target before publication.';
  if(manifest)table('candidate-table',state.detail.preview.fields,state.detail.preview.rows);
  if(run.data.publication)$('review-status').textContent+=' · Published '+short(run.data.publication.snapshot)+' revision '+run.data.publication.revision;
  buttons();
}
$('refresh').addEventListener('click',()=>action(async()=>{await refresh();await loadRun();}));
$('session-form').addEventListener('submit',event=>{event.preventDefault();token=$('session-key').value;sessionStorage.setItem('hud-session',token);action(()=>refresh(true));});
$('acquire-form').addEventListener('submit',event=>{event.preventDefault();action(async()=>{
  await api('/api/acquire',metadata());await refresh(true);notice('The complete official release and exact workbook index are retained.');
});});
$('import-capture').addEventListener('click',()=>action(async()=>{
  const files=new Map([...$('capture-files').files].map(file=>[file.name,file])),year=String(Number($('fiscal-year').value)).slice(-2);
  const roles={workbook:'Section8-FY'+year+'.xlsx',areas:'area-definitions-FY'+year+'.pdf',methodology:'IncomeLimitsMethodology-FY'+year+'.pdf',index:'hud-income-limits-index.html'},uploads={};
  for(const [role,name]of Object.entries(roles)){
    const file=files.get(name),receipt=files.get(name+'.capture.json')??(role==='index'?files.get('hud-income-limits-index.capture.json'):undefined);
    if(!file||!receipt)throw new Error('Select '+name+' and its original capture receipt.');
    const data=new Uint8Array(await file.arrayBuffer());let binary='';
    for(let i=0;i<data.length;i+=16384)binary+=String.fromCharCode(...data.subarray(i,i+16384));
    uploads[role]={base64:btoa(binary),receipt:JSON.parse(await receipt.text())};
  }
  await api('/api/import',{metadata:metadata(),uploads});await refresh(true);notice('The original source capture is retained and indexed.');
}));
$('selection-form').addEventListener('submit',event=>{event.preventDefault();action(async()=>{
  await api('/api/select',{releaseId:$('selected-release').value,selection:inputSelection(),expectedRevision:state.status.revision});
  state.plan=null;await refresh(true);await browse();notice('Saved the exact source selection. Existing publication plans retain their prior selections.');
});});
$('browse-form').addEventListener('submit',event=>{event.preventDefault();state.search=$('locality-search').value;action(()=>browse(0));});
$('export-selection').addEventListener('click',()=>action(async()=>{
  const document=await api('/api/export-selection',{});download(document,'hud-published-selection-'+document.release.fiscalYear+'.json');
}));
$('plan-form').addEventListener('submit',event=>{event.preventDefault();action(async()=>{
  const plan=await api('/api/plan',{expectedRevision:state.status.revision,title:$('plan-title').value,name:$('dataset-name').value});
  state.plan=plan.id;await refresh();notice('Saved plan '+plan.id+' with its original release and complete source files.');
});});
$('extract').addEventListener('click',()=>action(async()=>{
  const run=await api('/api/extract',{planId:state.plan});state.run=run.id;state.detail=null;state.offer=null;state.buyer=null;await refresh();
}));
$('cancel').addEventListener('click',()=>action(async()=>{await api('/api/cancel',{id:state.status.publisher.active.id});await refresh();}));
$('load-run').addEventListener('click',()=>action(async()=>{state.run=$('run-select').value;state.offer=null;state.buyer=null;await loadRun();}));
$('recover').addEventListener('click',()=>action(async()=>{await api('/api/recover',{id:state.run});await refresh();await loadRun();}));
$('review-form').addEventListener('submit',event=>{event.preventDefault();action(async()=>{
  const target=state.status.target;
  if(!state.run||!target||!target.initializable&&!target.connected)throw new Error('Open a complete extraction and its original dataset target first.');
  await api('/api/review',{id:state.run,reviewer:$('publication-reviewer').value,note:$('publication-note').value,
    ...(target.initializable?{initialize:true}:{expectedSnapshot:target.versions.current,expectedRevision:target.versions.revision})});
  await refresh();await loadRun();
});});
$('publish').addEventListener('click',()=>action(async()=>{
  await api('/api/publish',{id:state.run,reviewId:state.detail.run.data.review.id});await refresh();await loadRun();
}));
$('preview-form').addEventListener('submit',event=>{event.preventDefault();action(()=>loadRun($('preview-query').value));});
$('merchant-form').addEventListener('submit',event=>{event.preventDefault();action(async()=>{
  await api('/api/merchant/configure',{expectedRevision:state.status.revision,runId:state.run,
    origin:$('merchant-origin').value,path:$('merchant-path').value,port:Number($('merchant-port').value),
    payment:{scheme:'exact',network:$('payment-network').value,asset:$('payment-asset').value,payTo:$('payment-payto').value,
      amount:$('payment-amount').value,maxTimeoutSeconds:Number($('payment-timeout').value)}});
  await refresh();
});});
$('merchant-start').addEventListener('click',()=>action(async()=>{await api('/api/merchant/start',{});await refresh();}));
$('merchant-stop').addEventListener('click',()=>action(async()=>{await api('/api/merchant/stop',{});await refresh();}));
$('offer-form').addEventListener('submit',event=>{event.preventDefault();action(async()=>{
  state.offer=await api('/api/buyer-offer?id='+encodeURIComponent(state.run)+'&query='+encodeURIComponent($('buyer-query').value));
  state.offer.reviewedQuery=$('buyer-query').value;state.offer.runId=state.run;
  $('offer').textContent=JSON.stringify({snapshot:state.offer.snapshot,resource:state.offer.url,accepts:state.offer.accepts},null,2);
  $('buyer-alternative').replaceChildren();
  state.offer.accepts.forEach((payment,index)=>$('buyer-alternative').append(node('option',payment.amount+' · '+payment.network+' · '+payment.asset,{value:index})));
  $('buyer-intent').value='hud-'+crypto.randomUUID();
});});
$('buyer-form').addEventListener('submit',event=>{event.preventDefault();action(async()=>{
  if(!state.offer||state.offer.runId!==state.run||state.offer.reviewedQuery!==$('buyer-query').value)throw new Error('Load the current query and original seller offer first.');
  state.buyer=await api('/api/buyer-prepare',{id:state.run,query:$('buyer-query').value,offerSha256:state.offer.offerSha256,
    intentId:$('buyer-intent').value,acceptIndex:Number($('buyer-alternative').value)});
  $('buyer-result').textContent='Prepared original buyer configuration · snapshot '+short(state.buyer.snapshot)+' · '+state.buyer.configSha256;
  buttons();
});});
$('download-buyer').addEventListener('click',()=>{if(state.buyer)download(state.buyer.configText,'hud-customer-buyer.json');});
$('compare-form').addEventListener('submit',event=>{event.preventDefault();action(async()=>{
  const result=await api('/api/compare',{before:$('compare-before').value,after:$('compare-after').value});
  $('comparison').textContent=JSON.stringify({before:result.before,after:result.after,selection:result.selection,counts:result.counts,
    changed:result.changed.slice(0,30),added:result.added.slice(0,10),removed:result.removed.slice(0,10)},null,2);
  download(result,'hud-source-comparison.json');
});});
$('older-history').addEventListener('click',()=>action(async()=>{state.historyOffset=state.status.publisher.pages.history.next;await refresh();}));
$('import-packet').addEventListener('click',()=>action(async()=>{
  const file=$('source-packet-file').files[0];
  if(!file)throw new Error('Choose the original public source packet JSON.');
  if(file.size>90*1024**2)throw new Error('The source packet exceeds the intake limit.');
  const packet=JSON.parse(await file.text());await api('/api/import-packet',packet);
  await refresh(true);notice('The exact public source documents and capture receipts are retained and indexed.');
}));
$('export-packet').addEventListener('click',()=>action(async()=>{
  download(await api('/api/source-packet?releaseId='+encodeURIComponent(state.status.selectedRelease)),'hud-public-source-packet.json');
}));
if(token)action(async()=>{await refresh(true);await loadRun();});else{$('session-panel').hidden=false;$('activity').textContent='Enter the original workspace session key.';}
let polling=false;
setInterval(async()=>{
  if(polling||!token||!state.status)return;polling=true;
  try{
    const prior=state.status.publisher?.active;await refresh();
    if(state.status.publisher?.active||prior)await loadRun();
  }catch(error){if(!state.busy)notice(error.message);}finally{polling=false;}
},3000);

$('publication-handoff').addEventListener('click',()=>action(async()=>{if(!state.run)throw new Error('Open a publication first.');download(await api('/api/publication-handoff',{id:state.run}),'hud-publication-handoff.json');}));

let pilotState=null;
async function loadPilot(){
  pilotState=await api('/api/releases/status',{});
  $('pilot-status').textContent=JSON.stringify({state:pilotState.state,runtime:pilotState.runtime},null,2);
  $('pilot-selected').replaceChildren();
  for(const release of pilotState.releases??[])$('pilot-selected').append(node('option',release.label+' · '+release.id,{value:release.id}));
  if(pilotState.state.active)$('pilot-selected').value=pilotState.state.active;
}
$('pilot-refresh').addEventListener('click',()=>action(loadPilot));
$('pilot-stage-form').addEventListener('submit',event=>{event.preventDefault();action(async()=>{
  if(!state.run)throw new Error('Open the prepared extraction first.');
  const facilitator=$('pilot-facilitator').value.trim();
  await api('/api/releases/stage',{runId:state.run,id:$('pilot-id').value,label:$('pilot-label').value,
    runtime:{port:Number($('merchant-port').value),...(facilitator?{facilitator}:{})}});
  await loadPilot();notice('The shared release lifecycle retained the original dataset package and version-store binding.');
});});
$('pilot-activate').addEventListener('click',()=>action(async()=>{
  if(!pilotState)throw new Error('Read the current release state first.');
  await api('/api/releases/activate',{id:$('pilot-selected').value,expectedGeneration:pilotState.state.generation});await loadPilot();
}));
$('pilot-rollback').addEventListener('click',()=>action(async()=>{
  if(!pilotState)throw new Error('Read the current release state first.');
  await api('/api/releases/rollback',{expectedGeneration:pilotState.state.generation});await loadPilot();
}));
$('pilot-start').addEventListener('click',()=>action(async()=>{
  if(!pilotState)throw new Error('Read and select the current release first.');
  await api('/api/releases/start',{expectedGeneration:pilotState.state.generation});await loadPilot();await refresh();
}));
$('pilot-stop').addEventListener('click',()=>action(async()=>{
  await api('/api/releases/stop',{});await loadPilot();await refresh();
}));
