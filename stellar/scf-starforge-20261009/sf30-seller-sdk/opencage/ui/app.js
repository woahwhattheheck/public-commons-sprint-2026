const $=id=>document.getElementById(id);
const state={workspace:null,request:null,chosen:null,package:null,packages:[],deliveries:[],compared:null,readOnly:false,view:'requests',busy:false};
const sessionKey='starforge-geocoding:'+location.origin;
let token=location.hash.slice(1);
if(/^[a-f0-9]{64}$/.test(token)){sessionStorage.setItem(sessionKey,token);history.replaceState(null,'',location.pathname);}
else token=sessionStorage.getItem(sessionKey)??'';
const json=value=>JSON.stringify(value,null,2);
function node(tag,text='',className=''){const value=document.createElement(tag);if(text!==null)value.textContent=String(text);if(className)value.className=className;return value;}
function empty(element){element.replaceChildren();}
function notify(message,error=false){$('notice').hidden=false;$('notice').textContent=message;$('notice').className=error?'error':'';}
async function api(path,data){
  const response=await fetch(path,{method:data===undefined?'GET':'POST',headers:{authorization:'Bearer '+token,
    ...(data===undefined?{}:{'content-type':'application/json'})},...(data===undefined?{}:{body:JSON.stringify(data)})});
  const value=await response.json();
  if(!response.ok)throw new Error(value.message??value.error??'Request failed');
  return value;
}
async function download(path,name){
  const response=await fetch(path,{headers:{authorization:'Bearer '+token}});
  if(!response.ok){const value=await response.json();throw new Error(value.message??value.error);}
  const url=URL.createObjectURL(await response.blob()),link=document.createElement('a');link.href=url;link.download=name;
  link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
}
const actionButtons=new Set();
function action(id,callback,event='click'){
  const target=$(id),button=target.tagName==='FORM'?target.querySelector('button[type=submit]'):target;
  if(button)actionButtons.add(button);
  target.addEventListener(event,async e=>{
    e.preventDefault();
    if(state.busy)return;
    state.busy=true;
    const previous=[...actionButtons].map(control=>[control,control.disabled]);
    for(const control of actionButtons)control.disabled=true;
    document.body.setAttribute('aria-busy','true');syncButtons();
    try{await callback(e);}catch(error){notify(error.message,true);}
    finally{
      state.busy=false;
      for(const [control,disabled] of previous)control.disabled=disabled;
      document.body.removeAttribute('aria-busy');syncButtons();
    }
  });
}
function facts(id,items){
  const target=$(id);empty(target);
  for(const [label,value] of items){target.append(node('dt',label),node('dd',value===null||value===undefined?'—':value));}
}
function qs(values){return new URLSearchParams(values).toString();}
function requestId(){return 'g-'+Date.now().toString(36)+'-'+crypto.randomUUID().slice(0,8);}
function product(){return state.workspace?.configuration?.plan.products.find(item=>item.id===$('product').value);}
function input(){
  const extra=JSON.parse($('options').value||'{}');
  if(!extra || typeof extra!=='object'||Array.isArray(extra)||Object.hasOwn(extra,'q'))throw new Error('Options must be a JSON object without q.');
  return {q:$('query').value,...extra};
}
function preview(){
  try{const selected=product(),parameters={...selected.defaults,...input()};
    $('query-preview').textContent=json({method:'GET',endpoint:'https://api.opencagedata.com/geocode/v1/json',
      productId:selected.id,mode:selected.mode,query:parameters});
  }catch(error){$('query-preview').textContent=error.message;}
}
function syncButtons(){
  const busy=state.busy,result=state.request,selectable=Boolean(result&&result.state.providerStatus===200);
  $('save-choice').disabled=busy||state.readOnly||!selectable||state.chosen===null;
  $('clear-choice').disabled=busy||state.readOnly||!selectable||result?.decision.current?.index===null||!result?.decision.current;
  $('export-result').disabled=busy||state.readOnly||!selectable;
  $('stage-package').disabled=busy||!state.package;
  const merchant=state.workspace?.merchant,generation=merchant?.state?.generation;
  $('compare-release').disabled=busy||!merchant?.releases?.some(release=>release.id===$('release-select').value);
  $('activate-release').disabled=busy||!state.compared||state.compared.id!==$('release-select').value||state.compared.generation!==generation;
  $('start-release').disabled=busy||!merchant?.state?.active||Boolean(state.workspace?.ownsRunningRelease);
  $('stop-release').disabled=busy||!state.workspace?.ownsRunningRelease;
  $('rollback-release').disabled=busy||!merchant?.state?.previous;
}
async function setView(view){
  state.view=view;
  for(const element of document.querySelectorAll('.view'))element.hidden=element.id!=='view-'+view;
  for(const button of document.querySelectorAll('nav button'))button.classList.toggle('active',button.dataset.view===view);
  if(view==='merchant')await refreshMerchant();
  if(view==='deliveries')await refreshDeliveries();
}
for(const button of document.querySelectorAll('nav button'))button.addEventListener('click',()=>setView(button.dataset.view).catch(e=>notify(e.message,true)));
function outcomeText(value){
  const code=value.state.outcome??value.state.state;
  return ({
    CANDIDATES:'Review the returned locations and save the candidate that fits the customer’s intended place.',
    NO_RESULTS:'The provider completed this query with zero results. Its complete response can be delivered or a new query can be prepared.',
    QUOTA_EXCEEDED:'The provider reports exhausted quota. Check the account’s reset or plan, then prepare a new request when capacity is available.',
    RATE_LIMITED:'The provider rate limit was reached. The retained capture preserves its status and Retry-After value.',
    AUTH_REQUIRED:'The provider requires a valid API key. Update the named process environment variable and restart the operator.',
    DISABLED_OR_IP_DENIED:'The provider reports a disabled account or an IP restriction. Review the account configuration before a new request.',
    GEOCODE_LOCAL_RATE_LIMIT:'The configured local request interval has not elapsed. Prepare a new request after the interval.',
    GEOCODE_API_KEY_REQUIRED:'Set the plan’s named API key environment variable for this operator process.',
    GEOCODE_TRANSPORT_CONFIGURATION_UNAVAILABLE:'Check the selected proxy environment and supported Node version on this host, then reopen the operator with that configuration.',
    RECONCILE_RESULT:'This attempt has no complete result. Import its exact retained HTTP observation to reconcile the same request.',
    DISPATCHING:'The retained attempt is awaiting its complete result. Reopen it after the running operation completes.',
    PREPARED:'The exact request is prepared and has no complete response yet.',
  })[code]??'The original capture preserves this outcome. Open its source record for the exact application and provider status.';
}
function renderRequests(){
  empty($('request-list'));
  const requests=state.workspace.requests??[];
  $('request-count').textContent=requests.length+' retained';
  if(!requests.length){const row=node('tr');const cell=node('td','No source requests yet.');cell.colSpan=4;row.append(cell);$('request-list').append(row);}
  for(const value of [...requests].reverse()){
    const row=node('tr');row.classList.toggle('selected',state.request?.request.id===value.id);
    const identity=node('td'),button=node('button',value.id,'text-button');
    button.addEventListener('click',()=>loadRequest(value.id).catch(e=>notify(e.message,true)));
    identity.append(button,node('div',value.query?.q??'','hint wrap'));
    row.append(identity,node('td',value.outcome??value.state),node('td',value.candidateCount??'—'),
      node('td',value.selectedIndex===null||value.selectedIndex===undefined?'Unselected':'Candidate '+value.selectedIndex));
    $('request-list').append(row);
  }
}
function renderRequest(value){
  state.request=value;state.chosen=value.decision.current?.index??null;
  $('review-empty').hidden=true;$('review-content').hidden=false;
  $('review-id').textContent=value.request.id??'Original customer result';$('review-query').textContent=value.request.query.q;
  $('review-state').textContent=value.state.outcome??value.state.state;
  $('outcome-explanation').textContent=outcomeText(value);
  facts('review-facts',[['Native HTTP',value.state.providerStatus],['Candidates',value.candidates.length],
    ['Decision revision',value.decision.revision],['Response SHA-256',value.responseSha256],['Response bytes',value.responseBytes],
    ...(value.merchantSelection ? [['Buyer merchant origin',value.merchantSelection.publicOrigin],
      ['Buyer package',value.merchantSelection.packageIdentity??'Workspace terms'],['Buyer terms SHA-256',value.merchantSelection.termsSha256]] : [])]);
  empty($('candidate-list'));
  for(const candidate of value.candidates){
    const row=node('tr',null,'candidate'),choice=node('td'),radio=document.createElement('input');
    radio.type='radio';radio.name='candidate';radio.value=String(candidate.index);
    radio.checked=candidate.index===state.chosen;radio.disabled=state.readOnly;
    radio.setAttribute('aria-label','Choose candidate '+candidate.index);
    const choose=()=>{if(state.readOnly)return;state.chosen=candidate.index;
      for(const child of $('candidate-list').querySelectorAll('input'))child.checked=Number(child.value)===state.chosen;
      for(const child of $('candidate-list').children)child.classList.toggle('selected',Number(child.dataset.index)===state.chosen);
      syncButtons();};
    radio.addEventListener('change',choose);row.addEventListener('click',choose);row.dataset.index=String(candidate.index);
    row.classList.toggle('selected',radio.checked);choice.append(radio);
    const locationCell=node('td');locationCell.append(node('div',candidate.formatted,'address'),
      node('div',json(candidate.components??{}),'components wrap'));
    row.append(choice,locationCell,node('td',candidate.geometry.lat+', '+candidate.geometry.lng,'mono'),
      node('td',candidate.confidence+' / 10'));
    $('candidate-list').append(row);
  }
  $('candidate-table').hidden=!value.candidates.length;$('decision-controls').hidden=state.readOnly||value.state.providerStatus!==200;
  $('decision-note').value=value.decision.current?.note??'';
  $('review-native').textContent=json({semantics:value.semantics,decision:value.decision,candidates:value.candidates,capture:value.state});
  $('download-response').disabled=!value.responseSha256;$('download-capture').hidden=state.readOnly;
  syncButtons();if(!state.readOnly)renderRequests();
}
async function loadRequest(id){
  const value=await api('/api/request?'+qs({id}));renderRequest(value);
  sessionStorage.setItem('geocode-selected:'+state.workspace.identity,id);
}
function renderContract(){
  const configuration=state.workspace.configuration;
  facts('contract-facts',[['Workspace',configuration.plan.name],['Plan identity',configuration.planSha256],
    ['Key environment',configuration.plan.apiKeyEnv],
    ['Outbound transport',configuration.plan.transport?.mode??'direct'],
    ...(configuration.plan.transport?.proxyEnv ? [['Proxy environment',configuration.plan.transport.proxyEnv]] : []),
    ['Minimum interval',configuration.plan.minIntervalMs+' ms'],
    ['Request timeout',configuration.plan.timeoutMs+' ms'],['Response limit',configuration.plan.maxResponseBytes+' bytes']]);
  empty($('contract-products'));
  for(const item of configuration.plan.products){
    const row=node('tr');row.append(node('td',item.name),node('td','GET '+item.path,'mono'),node('td',item.mode),
      node('td',json({options:item.options,defaults:item.defaults}),'mono wrap'));$('contract-products').append(row);
  }
  $('configuration').textContent=json(configuration);
}
async function refresh(){
  const value=await api('/api/workspace');state.readOnly=Boolean(value.readOnly);
  if(state.readOnly){
    state.workspace=value;$('connection').textContent='Reopened customer delivery';$('workspace-title').textContent='Customer geocoding delivery';
    $('workspace-subtitle').textContent='Original result and saved decision revision '+value.delivery.decision.revision+'.';
    $('intake').hidden=true;$('refresh').hidden=true;
    for(const button of document.querySelectorAll('nav button'))button.hidden=button.dataset.view!=='requests';
    $('request-list').closest('section').hidden=true;
    const delivery=value.delivery;renderRequest({request:delivery.request,decision:delivery.decision,
      responseSha256:delivery.responseSha256,responseBytes:delivery.responseBytes,candidates:delivery.candidates,
      semantics:delivery.semantics,merchantSelection:delivery.provenance?.merchantSelection??null,
      state:{state:'COMPLETE',outcome:delivery.state,providerStatus:200}});
    return;
  }
  const previous=state.workspace?.identity;state.workspace=value;
  $('connection').textContent=value.configuration.plan.name+' · '+value.totals.completed+' complete · '+value.totals.selected+' selected';
  $('workspace-title').textContent=value.configuration.plan.name;
  if(previous!==value.identity){
    empty($('product'));
    for(const item of value.configuration.plan.products){const option=node('option',item.name);option.value=item.id;$('product').append(option);}
    $('request-id').value=requestId();$('query').value=product().mode==='reverse'?'51.952659,7.632473':'Münster, Germany';
    $('terms').value=json(value.configuration.terms);renderContract();preview();
  }
  $('key-state').textContent=value.source.keyConfigured?'Provider key configured in '+value.configuration.plan.apiKeyEnv+'.':
    'Set '+value.configuration.plan.apiKeyEnv+' before dispatch. Retained results remain available.';
  $('transport-state').textContent=value.source.transport?.mode==='environment-proxy'
    ? 'Selected host proxy: '+value.source.transport.proxyEnv+'. Its value stays in the private process environment.'
    : 'Direct HTTPS to api.opencagedata.com.';
  renderRequests();renderMerchant();
  const id=state.request?.request.id??sessionStorage.getItem('geocode-selected:'+value.identity);
  if(id&&value.requests.some(item=>item.id===id))await loadRequest(id);
  syncButtons();
}
async function runQuery(imported=false){
  const args={id:$('request-id').value,productId:$('product').value,input:input()};
  let value;
  if(imported){
    const observation=$('observation-file').files[0],response=$('response-file').files[0];
    if(!observation||!response)throw new Error('Choose both original files.');
    if(observation.size>262144||response.size>1048576)throw new Error('The selected source files exceed this product’s limits.');
    const bytes=new Uint8Array(await response.arrayBuffer());let binary='';
    for(let offset=0;offset<bytes.length;offset+=32768)binary+=String.fromCharCode(...bytes.subarray(offset,offset+32768));
    value=await api('/api/import-response',{...args,observation:JSON.parse(await observation.text()),responseBase64:btoa(binary)});
  }else value=await api('/api/capture',args);
  await refresh();renderRequest(value);$('request-id').value=requestId();
  sessionStorage.setItem('geocode-selected:'+state.workspace.identity,value.request.id);
  notify('Retained '+value.request.id+' · '+(value.state.outcome??value.state.state)+'.');
}
action('query-form',()=>runQuery(),'submit');action('import-result',()=>runQuery(true));
$('product').addEventListener('change',()=>{$('query').value=product().mode==='reverse'?'51.952659,7.632473':'Münster, Germany';$('options').value='{}';preview();});
$('query').addEventListener('input',preview);$('options').addEventListener('input',preview);
action('refresh',refresh);action('refresh-merchant',refreshMerchant);action('refresh-deliveries',refreshDeliveries);
action('save-choice',async()=>{
  const value=state.request;
  const updated=await api('/api/select',{id:value.request.id,responseSha256:value.responseSha256,
    index:state.chosen,expectedRevision:value.decision.revision,note:$('decision-note').value});
  renderRequest(updated);await refresh();notify('Candidate decision saved at revision '+updated.decision.revision+'.');
});
action('clear-choice',async()=>{
  const value=state.request;
  renderRequest(await api('/api/select',{id:value.request.id,responseSha256:value.responseSha256,index:null,
    expectedRevision:value.decision.revision,note:$('decision-note').value}));
  await refresh();notify('Selection cleared in the retained decision history.');
});
action('export-result',async()=>{
  const value=state.request,result=await api('/api/export',{id:value.request.id,responseSha256:value.responseSha256,
    expectedRevision:value.decision.revision});notify('Prepared customer delivery '+result.exportId+'.');
  await setView('deliveries');await showDelivery(result.exportId);
});
action('download-response',()=>download(state.readOnly?'/api/response':'/api/capture-file?'+qs({id:state.request.request.id,name:'response.json'}),'response.json'));
action('download-capture',()=>download('/api/capture-file?'+qs({id:state.request.request.id,name:'capture.json'}),'capture.json'));
function generation(){return state.workspace?.merchant?.state?.generation??0;}
function renderMerchant(){
  const merchant=state.workspace?.merchant;if(!merchant)return;
  $('release-state').textContent=merchant.runtime?.state??merchant.state??'UNPREPARED';
  facts('release-facts',[['Selection generation',merchant.state?.generation??0],['Active release',merchant.state?.active??null],
    ['Previous release',merchant.state?.previous??null],['Running mode',merchant.runtime?.observed?.mode??null],
    ['Listener',merchant.runtime?.observed?.listener??null]]);
  const prior=$('release-select').value;empty($('release-select'));
  for(const item of merchant.releases??[]){
    const option=node('option',item.id+(item.label?' · '+item.label:''));option.value=item.id;$('release-select').append(option);
  }
  if([...$('release-select').options].some(option=>option.value===prior))$('release-select').value=prior;
  $('release-native').textContent=json(merchant);syncButtons();
}
async function refreshMerchant(){
  if(state.readOnly)return;
  await refresh();state.packages=await api('/api/packages');
  const prior=state.package?.packageId??sessionStorage.getItem('geocode-package:'+state.workspace.identity);
  empty($('package-select'));
  for(const item of state.packages){const option=node('option',item.packageId);option.value=item.packageId;$('package-select').append(option);}
  if(prior&&state.packages.some(item=>item.packageId===prior))await showPackage(prior);
  else if(state.packages.length)await showPackage(state.packages.at(-1).packageId);
}
async function showPackage(packageId){
  const value=await api('/api/package?'+qs({packageId}));state.package={packageId,...value};
  $('package-details').hidden=false;$('package-select').value=packageId;
  $('package-identity').textContent=value.manifest.identity;empty($('package-files'));
  for(const file of value.manifest.files){
    const row=node('tr'),cell=node('td'),button=node('button','Download','text-button');
    button.addEventListener('click',()=>download('/api/merchant-file?'+qs({packageId,name:file.name}),
      file.name.split('/').at(-1)).catch(e=>notify(e.message,true)));
    cell.append(button);row.append(node('td',file.name,'mono'),node('td',file.bytes),cell);$('package-files').append(row);
  }
  sessionStorage.setItem('geocode-package:'+state.workspace.identity,packageId);syncButtons();
}
$('package-select').addEventListener('change',()=>showPackage($('package-select').value).catch(e=>notify(e.message,true)));
action('prepare-package',async()=>{
  const value=await api('/api/package',{terms:JSON.parse($('terms').value)});
  await refreshMerchant();await showPackage(value.packageId);notify('Prepared package '+value.packageId+' with exact native request and payment contracts.');
});
action('stage-form',async()=>{
  if(!state.package)throw new Error('Prepare and review a package first.');
  const facilitator=$('facilitator').value.trim();
  const id=$('release-id').value;
  const result=await api('/api/stage',{packageId:state.package.packageId,id,
    label:$('release-label').value,port:0,...(facilitator?{facilitator}:{})});
  state.compared=null;await refresh();$('release-select').value=id;
  notify('Staged original SF82 release '+id+'. Review its request and payment changes before activation.');
},'submit');
action('compare-release',async()=>{
  const id=$('release-select').value;
  const value=await api('/api/release-diff?'+qs({before:state.workspace.merchant.state?.active??'',after:id}));
  $('release-diff').textContent=json(value);$('release-diff-details').open=true;
  state.compared={id,generation:generation()};syncButtons();
});
$('release-select').addEventListener('change',()=>{state.compared=null;syncButtons();});
action('activate-release',async()=>{
  if(!state.compared)throw new Error('Review this release’s changes first.');
  await api('/api/activate',{id:state.compared.id,expectedGeneration:state.compared.generation,
    reason:'Geocoding operator reviewed original contract and payment changes'});
  state.compared=null;await refresh();notify('Original release selection updated.');
});
action('start-release',async()=>{const result=await api('/api/start',{expectedGeneration:generation()});await refresh();
  notify('Original SF82 seller running at '+result.url+' · '+result.mode+'.');});
action('stop-release',async()=>{await api('/api/stop',{});await refresh();notify('Owned original seller stopped and its release state retained.');});
action('rollback-release',async()=>{await api('/api/rollback',{expectedGeneration:generation(),reason:'Geocoding operator selected previous release'});state.compared=null;await refresh();notify('Original previous release selected.');});
async function refreshDeliveries(){
  if(state.readOnly)return;state.deliveries=await api('/api/deliveries');empty($('delivery-list'));
  if(!state.deliveries.length)$('delivery-list').append(node('p','Prepare a delivery from a completed request.','hint'));
  for(const value of [...state.deliveries].reverse()){
    const row=node('div',null,'delivery-row'),button=node('button',value.exportId,'text-button');
    button.addEventListener('click',()=>showDelivery(value.exportId).catch(e=>notify(e.message,true)));
    row.append(button,node('p',value.candidateCount+' candidates · decision '+value.decisionRevision+
      ' · '+(value.selectedIndex===null?'unselected':'candidate '+value.selectedIndex),'hint'));$('delivery-list').append(row);
  }
}
async function showDelivery(exportId){
  const value=await api('/api/export?'+qs({id:exportId})),entry=state.deliveries.find(item=>item.exportId===exportId);
  $('delivery-summary').className='';empty($('delivery-summary'));
  $('delivery-summary').append(node('h3',value.request.query.q),node('p',value.candidates.length+' native candidates; '+
    (value.selectedIndex===null?'no candidate selected.':'candidate '+value.selectedIndex+' selected.')),
    node('p','Response SHA-256: '+value.responseSha256,'mono wrap'));
  empty($('delivery-files'));
  for(const file of entry?.files??[]){
    const row=node('div',null,'delivery-row'),button=node('button',file.name+' · '+file.bytes+' bytes','text-button');
    button.addEventListener('click',()=>download('/api/export-file?'+qs({id:exportId,name:file.name}),
      file.name.split('/').at(-1)).catch(e=>notify(e.message,true)));row.append(button);$('delivery-files').append(row);
  }
  $('delivery-native').textContent=json(value);
}
refresh().catch(error=>{notify(error.message,true);$('connection').textContent='Operator session unavailable';});
