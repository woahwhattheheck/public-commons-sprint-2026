// MIT. Original native policy review and runtime controls; keys remain in the host.
const $=id=>document.getElementById(id);
const fragment=new URLSearchParams(location.hash.slice(1));
let token=fragment.get('token')??sessionStorage.getItem('native-facilitator-token');
if(fragment.has('token')){sessionStorage.setItem('native-facilitator-token',token);history.replaceState(null,'',location.pathname);}
let busy=false,workspace=null,runtime=null,selected=null,reviewed=null,cursor=null,importedOwnership=null;
let desiredPort=4020,profileProbe=null,runtimeProbe=null;
const make=(tag,text,className)=>{const e=document.createElement(tag);if(text!==undefined)e.textContent=text;if(className)e.className=className;return e;};
const notice=text=>{$('notice').textContent=text;};
function disabled(element,value){element.dataset.unavailable=String(Boolean(value));element.disabled=busy||value;}
function setBusy(value){busy=value;for(const element of document.querySelectorAll('button,input,textarea,select'))element.disabled=value||element.dataset.unavailable==='true';}
async function api(path,input,raw=false){
  const response=await fetch('/api/'+path,{headers:{Authorization:'Bearer '+token,...(input===undefined?{}:{'Content-Type':'application/json'})},
    ...(input===undefined?{}:{method:'POST',body:JSON.stringify(input)})});
  if(!response.ok){let result;try{result=await response.json();}catch{}throw new Error(result?.error??'Request failed: '+response.status);}
  return raw?response:response.json();
}
async function act(action){
  if(busy)return;setBusy(true);
  try{await action();}catch(error){notice(error.message);}
  finally{setBusy(false);try{await refreshStatus();}catch(error){notice(error.message);}}
}
const lines=id=>$(id).value.split(/\r?\n/).map(value=>value.trim()).filter(Boolean);
const number=id=>Number($(id).value);
function config(){
  const signers=lines('signers').map(line=>{const parts=line.split(/\s+/);if(parts.length!==2)throw new Error('Each settlement account needs one public address and one environment-variable name.');return {address:parts[0],secretEnv:parts[1]};});
  const feeAddress=$('fee-address').value.trim(),feeEnv=$('fee-env').value.trim();
  if(Boolean(feeAddress)!==Boolean(feeEnv))throw new Error('Provide both the fee-bump public account and environment-variable name.');
  return {schema:'stellar-forge.native-facilitator.v1',network:$('network').value,rpcUrl:$('rpc').value.trim(),signers,
    feeBumpSigner:feeAddress?{address:feeAddress,secretEnv:feeEnv}:null,
    payments:{assets:lines('assets'),recipients:lines('recipients'),maxAtomic:$('max-atomic').value.trim(),
      paymentFlows:['authorization','upfront'].filter(value=>$('flow-'+value).checked)},
    limits:{maxTransactionFeeStroops:number('fee-ceiling'),inclusionFeeStroops:number('inclusion-fee'),
      maxVerifyInFlight:number('verify-capacity'),maxSettleInFlight:number('settle-capacity'),drainGraceMs:number('drain-grace')},
    operations:{ownershipDirectory:importedOwnership??workspace.ownershipDirectory,rpcTimeoutMs:number('rpc-timeout'),
      readinessMaxAgeMs:number('readiness-age'),maxLedgerAgeSeconds:number('ledger-age'),requireReady:$('require-ready').checked}};
}
function fill(value,name){
  $('profile-name').value=name??'merchant-testnet';$('network').value=value.network;$('rpc').value=value.rpcUrl;
  $('signers').value=(value.signers??[]).map(item=>item.address+' '+item.secretEnv).join('\n');
  $('fee-address').value=value.feeBumpSigner?.address??'';$('fee-env').value=value.feeBumpSigner?.secretEnv??'';
  $('assets').value=(value.payments?.assets??[]).join('\n');$('recipients').value=(value.payments?.recipients??[]).join('\n');
  $('max-atomic').value=value.payments?.maxAtomic??'10000';
  for(const flow of ['authorization','upfront'])$('flow-'+flow).checked=(value.payments?.paymentFlows??['authorization']).includes(flow);
  for(const [id,key,fallback]of [['fee-ceiling','maxTransactionFeeStroops',50000],['inclusion-fee','inclusionFeeStroops',100],
    ['verify-capacity','maxVerifyInFlight',16],['settle-capacity','maxSettleInFlight',1],['drain-grace','drainGraceMs',60000]])$(id).value=value.limits?.[key]??fallback;
  for(const [id,key,fallback]of [['rpc-timeout','rpcTimeoutMs',10000],['readiness-age','readinessMaxAgeMs',30000],['ledger-age','maxLedgerAgeSeconds',120]])$(id).value=value.operations?.[key]??fallback;
  $('require-ready').checked=value.operations?.requireReady??false;importedOwnership=value.operations?.ownershipDirectory??null;
  reviewed=null;$('review').replaceChildren();
}
function summaryTable(value){
  const summary=value.summary,table=make('table'),tbody=make('tbody');
  for(const [label,text]of [['Network',summary.network],['RPC origin',summary.rpcOrigin],['Payment timing',summary.payments.paymentFlows.join(', ')],
    ['Maximum payment',summary.payments.maxAtomic+' atomic units'],['Allowed assets',summary.payments.assets.join('\n')],
    ['Merchant recipients',summary.payments.recipients.join('\n')],['Settlement capacity',summary.settlementConcurrency+' / '+summary.signers.length+' configured accounts'],
    ['Fee ceiling',summary.limits.maxTransactionFeeStroops+' stroops'],['Inclusion fee',summary.limits.inclusionFeeStroops+' stroops'],
    ['Fee-bump account',summary.feeBumpSigner?summary.feeBumpSigner.address+' · '+summary.feeBumpSigner.secretEnv:'None'],
    ['Signing account references',summary.signers.map(item=>item.address+' · '+item.secretEnv).join('\n')],
    ['Concurrent verifications',String(summary.limits.maxVerifyInFlight)],['Drain grace',summary.limits.drainGraceMs+' ms'],
    ['RPC readiness policy',(summary.operations.requireReady?'Required before payment':'Observed on request')+' · timeout '+summary.operations.rpcTimeoutMs+' ms · cache '+summary.operations.readinessMaxAgeMs+' ms · maximum ledger age '+summary.operations.maxLedgerAgeSeconds+' s'],
    ['Shared signer ownership',summary.operations.ownershipDirectory],['Native configuration SHA-256',value.sha256]]){
    const row=make('tr');row.append(make('th',label),make('td',text));tbody.append(row);
  }table.append(tbody);return table;
}
function renderReview(value){
  reviewed=value;const node=$('review');node.replaceChildren(make('h3','Reviewed policy'),summaryTable(value));
  const save=make('button','Save immutable profile','primary');save.id='save-profile';save.type='button';disabled(save,false);
  save.addEventListener('click',()=>act(async()=>{
    const retained=await api('save',{name:$('profile-name').value.trim(),config:value.config,expectedSha256:value.sha256});
    selected=retained;renderSelected();await refreshProfiles(true);
    notice((retained.reused?'Reopened the same saved profile. ':'Native configuration saved. ')+retained.path);
  }));node.append(save);
}
function commandBlock(commands){
  const detail=make('details');detail.append(make('summary','Original CLI argument arrays'),make('pre',JSON.stringify(commands,null,2)));
  return detail;
}
function renderSelected(){
  const node=$('selected');node.replaceChildren();if(!selected)return;
  node.className='selected-card';node.append(make('h3','Selected: '+selected.name),summaryTable(selected));
  const path=make('p',selected.path,'hint');node.append(path);
  const portLabel=make('label','HTTP listener port'),port=make('input');port.type='number';port.min='0';port.max='65535';port.value=desiredPort;port.id='listener-port';portLabel.append(port);
  port.addEventListener('input',()=>{desiredPort=Number(port.value);});disabled(port,Boolean(runtime));
  const actions=make('div',undefined,'actions'),start=make('button','Start native backend','primary'),probe=make('button','Probe configured RPC'),download=make('button','Download native profile'),edit=make('button','Edit as a new profile');
  start.id='start-native';probe.id='probe-profile';download.id='download-profile';
  for(const button of [start,probe,download,edit])button.type='button';
  disabled(start,Boolean(runtime));disabled(probe,false);disabled(download,false);disabled(edit,false);
  start.addEventListener('click',()=>act(async()=>{const result=await api('start',{name:selected.name,sha256:selected.sha256,port:desiredPort});renderStatus(result);notice('Native backend is accepting its configured payment profile at '+result.runtime.url+'.');}));
  probe.addEventListener('click',()=>act(async()=>{const target={name:selected.name,sha256:selected.sha256};const result=await api('probe',target);profileProbe={...target,observation:result.observation};renderSelected();notice('Configured RPC observation completed.');}));
  download.addEventListener('click',()=>act(async()=>{
    const response=await api('download?name='+encodeURIComponent(selected.name)+'&sha256='+selected.sha256,undefined,true),blob=await response.blob();
    const href=URL.createObjectURL(blob),a=make('a');a.href=href;a.download=selected.name+'.json';a.click();setTimeout(()=>URL.revokeObjectURL(href),1000);notice('Downloaded the exact original native profile.');
  }));
  edit.addEventListener('click',()=>{fill(selected.config,selected.name.slice(0,53)+'-revision');$('profile-form').scrollIntoView({behavior:'smooth',block:'start'});notice('Edit the copied policy and review it before saving under a new name.');});
  actions.append(start,probe,download,edit);node.append(portLabel,make('p','Port zero assigns a new local listener. The current runtime must drain before another profile or port starts.','hint'),actions,commandBlock(selected.commands));
  if(profileProbe?.name===selected.name&&profileProbe.sha256===selected.sha256)appendProbe(node,profileProbe.observation,'profile-probe-result');
}
function appendProbe(node,value,id){
  const detail=make('details');detail.id=id;detail.open=true;detail.append(make('summary','RPC readiness: '+value.state),make('pre',JSON.stringify(value,null,2)));node.append(detail);
}
function renderStatus(value){
  workspace=value.workspace??workspace;runtime=value.runtime??null;
  $('ownership').textContent='Shared signer ownership directory selected by the host: '+workspace.ownershipDirectory;
  $('runtime-state').textContent=runtime?(runtime.stopping?'Draining':'Accepting'):'Stopped';
  const node=$('runtime');node.replaceChildren();
  if(!runtime){node.append(make('p','Select a saved profile and start its original native backend.'));$('runtime-details').textContent='No runtime is open.';}
  else{
    const r=runtime,s=r.status;node.append(make('p',r.name+' · '+r.url),make('p','Started '+r.startedAt+' · '+s.paymentFlows.join(', ')+' · '+s.network,'hint'));
    const metrics=make('div',undefined,'metrics');
    for(const [label,count]of [['Native verifications',s.counters.verifyCalls],['Native settlements',s.counters.settleCalls],['Active settlements',s.activeSettle],['Available accounts',s.availableSettlementSlots]]){
      const box=make('div',undefined,'metric');box.append(make('strong',String(count)),make('span',label));metrics.append(box);
    }node.append(metrics);
    const table=make('table'),tbody=make('tbody');
    for(const account of s.settlementAccounts){const row=make('tr');row.append(make('td',account.address),make('td',account.state),make('td',account.startedAt??''));tbody.append(row);}table.append(tbody);node.append(table);
    const actions=make('div',undefined,'actions'),stop=make('button','Drain and stop'),probe=make('button','Probe running RPC');stop.id='stop-native';probe.id='probe-runtime';stop.type=probe.type='button';
    disabled(stop,r.stopping);disabled(probe,r.stopping);
    stop.addEventListener('click',()=>act(async()=>{const result=await api('stop',{runtimeId:r.id});renderStatus(result);notice(result.runtime?'Listener closed; the original SDK is finishing accepted work.':'Native backend drained and stopped. The saved profile remains available.');}));
    probe.addEventListener('click',()=>act(async()=>{const result=await api('probe',{runtimeId:r.id});runtimeProbe={runtimeId:r.id,observation:result.observation};renderStatus(result);notice('Running RPC observation completed.');}));
    actions.append(stop,probe);node.append(actions);$('runtime-details').textContent=JSON.stringify(r,null,2);
    if(runtimeProbe?.runtimeId===r.id)appendProbe(node,runtimeProbe.observation,'runtime-probe-result');
  }
  // Runtime polling must not replace a focused profile field or its observation.
  if($('listener-port'))disabled($('listener-port'),Boolean(runtime));
  if($('start-native'))disabled($('start-native'),Boolean(runtime));
}
async function refreshStatus(){renderStatus(await api('status'));}
async function refreshProfiles(reset=false){
  const page=await api('profiles'+(!reset&&cursor?'?after='+encodeURIComponent(cursor):''));
  if(reset)$('profiles').replaceChildren();cursor=page.next;
  for(const item of page.items){const button=make('button',item.name);button.type='button';button.dataset.profile=item.name;
    if(item.unavailable){button.append(make('small',item.error));disabled(button,true);}
    else{button.append(make('small',item.summary.network+' · '+item.summary.payments.paymentFlows.join(', ')));disabled(button,false);
      button.addEventListener('click',()=>act(async()=>{selected=await api('profile?name='+encodeURIComponent(item.name));desiredPort=4020;renderSelected();notice('Original profile reopened: '+item.name+'.');}));}
    $('profiles').append(button);
  }$('more-profiles').hidden=!cursor;
  if(reset&&!page.items.length)$('profiles').append(make('p','No profiles are saved yet. Complete the review below.','hint'));
}
$('profile-form').addEventListener('submit',event=>{event.preventDefault();act(async()=>{renderReview(await api('review',{config:config()}));notice('Policy review completed. Check the recipient, maximum amount, payment timing and signer references before saving.');});});
$('profile-form').addEventListener('input',()=>{reviewed=null;$('review').replaceChildren();});
$('refresh').addEventListener('click',()=>act(async()=>{await refreshProfiles(true);notice('Saved profiles and native state refreshed.');}));
$('more-profiles').addEventListener('click',()=>act(()=>refreshProfiles()));
$('new-profile').addEventListener('click',()=>{selected=null;reviewed=null;importedOwnership=null;$('profile-form').reset();$('review').replaceChildren();renderSelected();notice('New profile. Supply the existing public accounts and host key references.');});
$('network').addEventListener('change',()=>{if($('network').value==='stellar:pubnet'){$('rpc').value='';notice('Enter the HTTPS RPC selected for this mainnet deployment.');}});
$('import-profile').addEventListener('change',()=>act(async()=>{
  const file=$('import-profile').files[0];if(!file)return;if(file.size>65536)throw new Error('Native configuration files must be at most 64 KiB.');
  const value=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(await file.arrayBuffer()));
  fill(value,file.name.replace(/\.json$/i,'').replace(/[^A-Za-z0-9_-]/g,'-').slice(0,64));
  notice('Imported the native configuration for review. Its original shared ownership directory is preserved.');
}));
try{if(!token)throw new Error('Open the complete local operator URL printed by the launcher.');await refreshStatus();await refreshProfiles(true);notice('Native facilitator workspace ready.');}
catch(error){notice(error.message);}
setInterval(()=>{if(!busy)refreshStatus().catch(error=>notice(error.message));},3000);
