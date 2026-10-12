// MIT. Private original-workspace channel operator.
const $=id=>document.getElementById(id), encode=encodeURIComponent;
const token=location.hash.slice(1)||sessionStorage.getItem('mpp-session');
if(token){sessionStorage.setItem('mpp-session',token);history.replaceState(null,'',location.pathname);}
let state=null,contract=null,draft=null,selectedId=null,revision=0;
const jobs=new Map();let refreshing=false,funderDraft=null,funderRevision=0;
const json=value=>JSON.stringify(value,null,2), copy=value=>JSON.parse(JSON.stringify(value));
function say(value,error=false){$('message').textContent=value;$('message').dataset.error=String(error);}
function inspect(value){$('inspector').textContent=json(value);}
async function api(path,body,{raw=false}={}){
  if(!token)throw new Error('Open the original workspace’s private URL to select its session.');
  const response=await fetch(path,{method:body===undefined?'GET':'POST',credentials:'same-origin',
    headers:{authorization:'Bearer '+token,...(body===undefined?{}:{'content-type':'application/json'})},
    ...(body===undefined?{}:{body:JSON.stringify(body)}),redirect:'error'});
  if(!response.ok){let error;try{error=(await response.json()).error;}catch{}
    throw new Error(error||'The workspace request did not complete ('+response.status+').');}
  return raw?response:response.json();
}
function formatError(error){
 const value=error?.message||String(error);
 const messages={
 MPP_CHANNEL_OPERATOR_TERMINAL_BUSY:'Another operator authorization is open. Complete it in the workspace terminal, then retry this selected operation.',
 MPP_CHANNEL_RESUME_ORIGINAL_PURCHASE:'This channel has an unfinished purchase. Resume that original purchase before creating another commitment.',
 MPP_CHANNEL_SIGNED_PURCHASE_REQUIRES_ORIGINAL_RECOVERY:'This purchase has a retained commitment. Use Resume to recover its original response.',
 MPP_CHANNEL_TASK_AUTHORITY_INACTIVE:'Save and authorize a current task budget before starting new work.',
 MPP_CHANNEL_TASK_BUDGET_EXHAUSTED:'The selected task budget is consumed. Review a revised task edition to authorize more work.',
 MPP_CHANNEL_TASK_REVISION_CHANGED:'The task changed. Refresh and reopen its current edition.',
 MPP_CHANNEL_ORIGINAL_HISTORY_CONFLICT:'The receiving workspace already has different operating history. Open the selected receiving workspace and retain both original histories.',
 MPP_CHANNEL_REFUND_LEDGER_NOT_REACHED:'The refund waiting period is still running. Refresh the channel balance to see the current ledger and refund deadline.',
 MPP_CHANNEL_FUNDING_CHANNEL_CLOSING:'This channel has begun closing. Use its retained operation and refund deadline.',
 MPP_CHANNEL_OUTSTANDING_EXCEEDS_BALANCE:'The unpaid part of this commitment exceeds the channel balance. Add funds or revise the selected work.',
 MPP_CHANNEL_RESUME_ORIGINAL_FINANCIAL_OPERATION:'Continue the channel’s saved funding, collection or close operation before starting another transaction.',
 MPP_CHANNEL_ORIGINAL_CUMULATIVE_HISTORY_REQUIRED:'Open the channel’s complete original commitment history before signing or accepting a newer purchase.',
 MPP_CHANNEL_OBSERVATION_LEDGER_ADVANCED:'The ledger advanced during this balance read. Refresh the selected channel state.',
 MPP_CHANNEL_UNPAID_INCREMENT_TOO_SMALL:'The new unpaid commitment does not cover this purchase’s authenticated price. Recover the original channel history and prepare its correct cumulative amount.',
 MPP_CHANNEL_NO_UNCOLLECTED_COMMITMENT:'The accepted commitment has already been collected. Continue paid work or choose Close.',
 MPP_CHANNEL_NO_REMAINING_FUNDS:'The selected channel has no remaining balance to return.',
 MPP_CHANNEL_CUSTODY_TRANSFERRED:'Operation moved with the complete channel handover. Continue in its receiving workspace.'
 };
 return messages[value]||value.replace(/^MPP_CHANNEL_/,'').replaceAll('_',' ').toLowerCase();
}
function listen(node,event,fn){node.addEventListener(event,e=>{e.preventDefault();Promise.resolve().then(()=>fn(e)).catch(error=>say(formatError(error),true));});}
function button(label,fn){const node=document.createElement('button');node.type='button';node.textContent=label;listen(node,'click',async()=>{
 node.disabled=true;try{await fn();}finally{node.disabled=false;}});return node;}
function cell(value){const td=document.createElement('td');
 if(value instanceof Node)td.append(value);else td.textContent=value===null||value===undefined?'—':String(value);
 return td;}
function actions(items){const span=document.createElement('span');for(const [label,fn]of items)span.append(button(label,fn));return span;}
function table(target,headers,rows){
 const root=$(target);root.replaceChildren();
 if(!rows.length){const p=document.createElement('p');p.className='empty';p.textContent='No saved records in this workspace.';root.append(p);return;}
 const node=document.createElement('table'),head=document.createElement('thead'),tr=document.createElement('tr');
 for(const label of headers){const th=document.createElement('th');th.scope='col';th.textContent=label;tr.append(th);}head.append(tr);node.append(head);
 const body=document.createElement('tbody');for(const row of rows){const tr=document.createElement('tr');for(const value of row)tr.append(cell(value));body.append(tr);}node.append(body);root.append(node);
}
function selectOptions(id,rows,getValue,getLabel){const node=$(id),prior=node.value;node.replaceChildren();
 for(const row of rows){const option=document.createElement('option');option.value=getValue(row);option.textContent=getLabel(row);node.append(option);}
 if(rows.some(row=>getValue(row)===prior))node.value=prior;}
function dateLocal(value){if(!value)return'';const d=new Date(value);if(!Number.isFinite(d.getTime()))return'';
 return new Date(d.getTime()-d.getTimezoneOffset()*60000).toISOString().slice(0,19);}
function loadDraft(value,rev=0){
 draft=copy(value);selectedId=value.taskId;revision=rev;
 const f=$('task-form').elements;
 for(const name of ['taskId','title','operator','usefulTask','dependencyRoot'])f[name].value=draft[name]||'';
 for(const name of ['maximumAtomic','maximumUnitAtomic','maximumPurchases'])f[name].value=draft.budget?.[name]??'';
 f.expiresAt.value=dateLocal(draft.budget?.expiresAt);f.keyEnv.value=draft.signer?.keyEnv||'MPP_CHANNEL_COMMITMENT_SECRET';
 $('task-json').value=json(draft);sourceSummary();purchaseDefault();
}
function formDraft(){
 if(!draft)throw new Error('Open a saved task or select a merchant offer first.');
 const result=copy(draft),f=$('task-form').elements;
 for(const name of ['taskId','title','operator','usefulTask','dependencyRoot'])result[name]=f[name].value;
 result.budget={maximumAtomic:f.maximumAtomic.value,maximumUnitAtomic:f.maximumUnitAtomic.value,
  maximumPurchases:Number(f.maximumPurchases.value),expiresAt:f.expiresAt.value?new Date(f.expiresAt.value).toISOString():''};
 result.signer={keyEnv:f.keyEnv.value};return result;
}
function sourceSummary(){
 const root=$('source-summary');root.replaceChildren();
 for(const [label,value]of [['Source',draft?.source?.title],['Edition',draft?.source?.edition],
 ['Authorized use',draft?.source?.authorization],['Priced unit',draft?.pricedUnit],
 ['Endpoint',draft?.request?.method+' '+draft?.request?.url],
 ['Channel',draft?.channel?.network+' / '+draft?.channel?.address]]){
 const p=document.createElement('p'),strong=document.createElement('strong');strong.textContent=label+': ';p.append(strong,document.createTextNode(value||'Select the actual source'));root.append(p);}
}
function currentTask(){const value=state?.tasks.find(row=>row.config.taskId===selectedId);
 if(!value)throw new Error('Select and save the original task.');return value;}
function purchaseDefault(){
 const f=$('purchase-form').elements,task=state?.tasks.find(row=>row.config.taskId===f.taskId.value)?.config||draft;
 if(task?.request){f.url.value=task.request.url||'';f.method.value=task.request.method||'POST';}
}
async function action(name,input){
 say('Working: '+name.replaceAll('-',' ')+'…');
 const started=await api('/api/channel/'+encode(name),input||{});
 if(started?.id&&started.state==='RUNNING'){
  jobs.set(started.id,{...started,kind:name});renderJobs();
  let result=started;
  while(result.state==='RUNNING'){
   await new Promise(done=>setTimeout(done,1000));
   result=await api('/api/jobs/'+encode(started.id));jobs.set(started.id,result);renderJobs();
  }
  await refresh();
  if(result.state==='FAILED')throw new Error(result.error||'Operation failed. Inspect its original record.');
  inspect(result.result);say(name.replaceAll('-',' ')+' completed.');return result.result;
 }
 inspect(started);await refresh();say(name.replaceAll('-',' ')+' completed.');return started;
}
function renderJobs(){table('jobs',['Operation','State','ID','Details'],[...jobs.values()].reverse().map(row=>[
 row.kind||'Channel operation',row.state,row.id,actions([['Inspect',()=>inspect(row)]]) ]));}
async function download(path,name){const response=await api(path,undefined,{raw:true}),blob=await response.blob();downloadBlob(blob,name);}
function downloadBlob(blob,name){const link=document.createElement('a');link.href=URL.createObjectURL(blob);link.download=name;link.click();setTimeout(()=>URL.revokeObjectURL(link.href),10000);}
function ownRecord(row){inspect(row);}
function archived(input) {
 const rpcUrl=$('archive-rpc').value.trim();return rpcUrl?{...input,rpcUrl}:input;
}
function loadFunder(value,rev=0) {
 funderDraft=copy(value);funderRevision=rev;
 const elements=$('funder-form').elements;
 elements.title.value=value.title||'';elements.dependencyRoot.value=value.dependencyRoot||'';
 for(const key of ['account','operator','maximumFeeStroops','keyEnv'])elements[key].value=value.funding?.[key]||'';
 const selected=(state?.channels||[]).find(row=>row.channel.network===value.channel?.network&&row.channel.address===value.channel?.address);
 if(selected)$('funder-channel').value=selected.streamKey;
 $('funder-summary').textContent=value.channel?.network+' / '+value.channel?.address+' · edition '+rev;
}
async function openFunder(stream) {
 const saved=state.funderProfiles?.find(row=>row.streamKey===stream);
 if(saved){const original=await api('/api/channel/funders/'+encode(stream));loadFunder(original.profile,original.setting.revision);}
 else loadFunder(await action('funder-template',{stream}),0);
}
function fundingAmount() {
 const topUp=$('funding-action').value==='top_up',field=$('funding-form').elements.amountAtomic;
 $('funding-amount-label').hidden=!topUp;field.disabled=!topUp;field.required=topUp;
}
function renderFunds() {
 const profiles=state.funderProfiles||[],channels=state.channels||[];
 selectOptions('funder-channel',channels,row=>row.streamKey,row=>row.channel.network+' / '+row.channel.address);
 selectOptions('funding-stream',profiles,row=>row.streamKey,row=>row.title+' · '+row.channel.address);
 table('funders',['Funding profile','Edition','Account','Actions'],profiles.map(row=>[
  row.title,row.revision,row.channel.funder,actions([['Open',()=>openFunder(row.streamKey)],['Inspect',()=>ownRecord(row)]])]));
 table('channel-balances',['Channel','Balance · base units','Collected cumulative','Close / refund','Ledger','Actions'],channels.map(row=>{
  const observation=(state.observations||[]).find(item=>item.channel.network===row.channel.network&&item.channel.address===row.channel.address)?.observation;
  const status=!observation?'Read current channel':observation.closeEffectiveAtLedger===null?'Open':
   observation.currentLedger>=observation.closeEffectiveAtLedger?'Refund available · ledger '+observation.closeEffectiveAtLedger:
   'Refund starts at ledger '+observation.closeEffectiveAtLedger;
  return[row.channel.network+' / '+row.channel.address,observation?.balanceAtomic,observation?.withdrawnAtomic,
   status,observation?.currentLedger,actions([['Refresh chain state',()=>action('channel-observe',{stream:row.streamKey})],
    ...(observation?[['Inspect',()=>ownRecord(observation)]]:[])])];
 }));
 const completed=['FUNDED','CLOSING','REFUNDED','FAILED','EXPIRED','CANCELLED'];
 const labels={top_up:'Add funds',close_start:'Start refund period',refund:'Return balance'};
 table('funding-operations',['Operation','Action','State','Amount · base units','Transaction','Actions'],[...(state.funding||[])].reverse().map(row=>{
  const items=[['Inspect',()=>ownRecord(row)]];
  if(!completed.includes(row.phase))items.push([row.phase==='DRAFT'?'Authorize':'Resume',
   ()=>action(row.phase==='DRAFT'?'funding-execute':'funding-resume',{fundingId:row.id})]);
  if(row.transaction)items.push(['Reconcile',()=>action('funding-reconcile',archived({fundingId:row.id}))]);
  if(['DRAFT','AUTHORIZED'].includes(row.phase))items.push(['Cancel unsigned',()=>action('funding-cancel',{fundingId:row.id})]);
  return[row.id,labels[row.action]||row.action,row.phase,row.amountAtomic||(row.action==='refund'?'Remaining at execution':'—'),
   row.transaction||'Prepared',actions(items)];
 }));
}
async function refresh(){
 if(refreshing)return;refreshing=true;
 try{
 state=await api('/api/channel/state');
 renderFunds();
 table('tasks',['Task','Status','Committed / cap · base units','Purchases','Actions'],state.tasks.map(row=>{
  const ledger=state.streams.find(s=>s.channel.address===row.config.channel.address&&s.channel.network===row.config.channel.network);
  const budget=ledger?.budgets?.[row.config.taskId];return[row.config.title+' · '+row.config.taskId,row.status,
   (budget?.committedAtomic||'0')+' / '+row.config.budget.maximumAtomic,
   (budget?.purchases||0)+' / '+row.config.budget.maximumPurchases,
   actions([['Open',()=>{loadDraft(row.config,row.revision);$('task-summary').textContent=row.config.title+' · edition '+row.revision+' · '+row.status;ownRecord(row);} ]])];}));
 selectOptions('purchase-task',state.tasks,row=>row.config.taskId,row=>row.config.title+' · '+row.config.taskId);
 table('purchases',['Purchase','Task','State','Amount / cumulative · base units','Actions'],[...state.purchases].reverse().map(row=>{
  const todo=[['Inspect',()=>ownRecord(row)]];
  if(row.phase==='COMPLETE')todo.push(['Response',()=>download('/api/channel/responses/'+encode(row.id),row.id+'.bin')]);
  else if(!['CANCELLED','CANCELLING'].includes(row.phase)){
   todo.push([row.phase==='READY'?'Execute':'Resume',()=>action(row.phase==='READY'?'purchase-execute':'purchase-resume',{purchaseId:row.id})]);
   if(['READY','CHALLENGE_REJECTED','RESERVED'].includes(row.phase))todo.push(['Refresh offer',()=>action('purchase-refresh',{purchaseId:row.id})]);
   todo.push(['Cancel unsigned',()=>action('purchase-cancel',{purchaseId:row.id})]);
  } else if(row.phase==='CANCELLING')todo.push(['Finish cancellation',()=>action('purchase-cancel',{purchaseId:row.id})]);
  return[row.id,row.taskId,row.phase,(row.reservation?.amountAtomic||row.challenge?.request?.amount||'—')+' / '+(row.reservation?.cumulativeAtomic||'—'),actions(todo)];
 }));
 table('merchants',['Merchant','Edition','Listener','Actions'],state.merchantProfiles.map(row=>{
  const live=state.merchants.find(x=>x.profileId===row.profileId),stream=state.streams.find(s=>s.channel.address===row.channel.address&&s.channel.network===row.channel.network);
  const key=stream?.streamKey||state.merchants.find(x=>x.profileId===row.profileId)?.stream||row.streamKey;
  const streamId=row.key||row.stream||key;
  // The server supplies the canonical channel stream key with every merchant selection.
  return[row.title,row.revision,live?'127.0.0.1:'+live.port:'Stopped',actions([
   ['Contract',async()=>inspect(await api('/api/channel/contracts/'+encode(row.streamKey)))],
   [live?'Stop':'Start',()=>action(live?'merchant-stop':'merchant-start',{stream:row.streamKey,port:Number($('merchant-port').value)})],
   ['Inspect',()=>ownRecord(row)]])];
 }));
 selectOptions('close-stream',state.merchantProfiles,row=>row.streamKey,row=>row.title+' · '+row.channel.address);
 const streams=state.channels||state.streams;
 selectOptions('handover-stream',streams,row=>row.streamKey,row=>(row.channel.network+' / '+row.channel.address));
 table('deliveries',['Delivery','Route','State','Cumulative · base units','Actions'],[...state.deliveries].reverse().map(row=>[
  row.id,row.routeId,row.state,row.amountAtomic,actions([['Inspect',()=>ownRecord(row)],...(row.state==='COMPLETE'?[]:[['Recover',()=>action('delivery-recover',{deliveryId:row.id})]])])]));
 table('settlements',['Operation','Action','State','Cumulative / expected collection · base units','Transaction','Actions'],[...state.settlements].reverse().map(row=>{
  const prefix=row.action==='settle'?'collection':'close',items=[['Inspect',()=>ownRecord(row)]];
  if(!['SETTLED','COLLECTED','FAILED','CANCELLED','EXPIRED'].includes(row.phase))items.push([
   row.phase==='DRAFT'?(prefix==='collection'?'Authorize collection':'Authorize close'):'Resume',
   ()=>action(prefix+(row.phase==='DRAFT'?'-execute':'-resume'),{settlementId:row.id})]);
  if(row.transaction)items.push(['Reconcile',()=>action(prefix+'-reconcile',archived({settlementId:row.id}))]);
  if(['DRAFT','AUTHORIZED'].includes(row.phase))items.push(['Cancel unsigned',()=>action(prefix+'-cancel',{settlementId:row.id})]);
  return[row.id,prefix==='collection'?'Collect and keep open':'Collect and close',row.phase,
   row.cumulativeAtomic+' / '+(row.expectedCollectionAtomic??'—'),row.transaction||'Prepared',actions(items)];
 }));
 table('receiving',['Handover','State','Source / destination','Actions'],state.receiving.filter(row=>row.sha256).map(row=>[
  row.id||row.handoverId||row.sha256.slice(0,12),row.state,row.root||row.path||'Original workspace',actions([
   ['Inspect',()=>ownRecord(row)],['Download',()=>download('/api/channel/handovers/'+row.sha256,'channel-handover-'+row.sha256.slice(0,12)+'.json')]
  ])]));
 }finally{refreshing=false;}
}
async function loadContract(value){contract=value;selectOptions('offers',value.offers||[],row=>row.id,row=>row.description+' · '+row.amountAtomic+' base units / '+row.pricedUnit);inspect(value);}
async function fileJSON(file){if(!file)throw new Error('Select the complete original JSON file.');if(file.size>128*1024*1024)throw new Error('The original file exceeds the supported channel handover size.');return JSON.parse(await file.text());}
listen($('refresh'),'click',async()=>{await refresh();say('Original workspace refreshed.');});
listen($('new-task'),'click',async()=>{loadDraft(await action('task-template',{}));$('task-summary').textContent='New planning edition';});
listen($('offer-form'),'submit',async()=>{const result=await action('contract-fetch',{origin:$('offer-form').elements.origin.value.replace(/\/$/,'')});await loadContract(result.contract);});
listen($('contract-file'),'change',async()=>loadContract(await fileJSON($('contract-file').files[0])));
listen($('use-offer'),'click',async()=>{if(!contract)throw new Error('Load the original merchant contract.');loadDraft(await action('task-template',{contract,offerId:$('offers').value}));});
listen($('apply-task-json'),'click',()=>loadDraft(JSON.parse($('task-json').value),revision));
listen($('task-file'),'change',async()=>{const value=await fileJSON($('task-file').files[0]);loadDraft(value.config||value,value.revision||0);});
listen($('task-form'),'submit',async()=>{const config=formDraft(),existing=state.tasks.find(row=>row.config.taskId===config.taskId);
 const result=await action('task-save',{config,expectedRevision:existing?.config.taskId===selectedId?revision:0});
 loadDraft(result.config,result.revision);$('task-summary').textContent=result.config.title+' · edition '+result.revision+' · '+result.status;});
listen($('save-task-file'),'click',()=>{const value=formDraft();downloadBlob(new Blob([json(value)+'\n'],{type:'application/json'}),value.taskId+'.json');});
listen($('authorize-task'),'click',()=>{const row=currentTask();return action('task-authorize',{taskId:row.config.taskId,expectedRevision:row.revision});});
listen($('resume-authority'),'click',()=>action('task-authority-resume',{taskId:currentTask().config.taskId}));
listen($('stop-task'),'click',()=>{const row=currentTask();return action('task-stop',{taskId:row.config.taskId,expectedRevision:row.revision});});
listen($('purchase-task'),'change',()=>purchaseDefault());
listen($('purchase-form'),'submit',async()=>{
 const f=$('purchase-form').elements,request={url:f.url.value,method:f.method.value};
 if(f.json.value.trim())request.json=JSON.parse(f.json.value);
 await action('purchase-prepare',{taskId:f.taskId.value,purchaseId:f.purchaseId.value,request});
});
listen($('merchant-form'),'submit',async()=>{
 const profile=await fileJSON($('merchant-form').elements.file.files[0]);
 const prior=state.merchantProfiles.find(row=>row.channel.address===profile.channel?.address&&row.channel.network===profile.channel?.network);
 await action('merchant-save',{profile,expectedRevision:prior?.revision||0});
});
listen($('close-form'),'submit',()=>{const f=$('close-form').elements;return action(f.operation.value+'-prepare',{stream:f.stream.value,settlementId:f.settlementId.value});});
listen($('settlement-action'),'change',()=>{$('settlement-prepare').textContent=$('settlement-action').value==='collection'?'Prepare collection':'Prepare channel close';});
listen($('load-funder'),'click',()=>openFunder($('funder-channel').value));
listen($('funder-file'),'change',async()=>{
 const value=await fileJSON($('funder-file').files[0]),profile=value.profile||value;
 const prior=state.funderProfiles?.find(row=>row.channel.network===profile.channel?.network&&row.channel.address===profile.channel?.address);
 loadFunder(profile,value.setting?.revision??prior?.revision??0);
});
listen($('funder-form'),'submit',async()=>{
 if(!funderDraft)throw new Error('Load the selected channel funding profile.');
 const profile=copy(funderDraft),fields=$('funder-form').elements;
 const selected=state.channels.find(row=>row.streamKey===$('funder-channel').value);
 if(!selected||selected.channel.network!==profile.channel.network||selected.channel.address!==profile.channel.address)
  throw new Error('Load the currently selected channel into the funding form.');
 profile.title=fields.title.value;profile.dependencyRoot=fields.dependencyRoot.value;
 profile.funding={account:fields.account.value,operator:fields.operator.value,
  maximumFeeStroops:fields.maximumFeeStroops.value,keyEnv:fields.keyEnv.value};
 const saved=await action('funder-save',{profile,expectedRevision:funderRevision});
 loadFunder(profile,saved.revision);
});
listen($('funding-action'),'change',fundingAmount);
listen($('funding-form'),'submit',()=>{
 const fields=$('funding-form').elements,input={stream:fields.stream.value,fundingId:fields.fundingId.value,action:fields.action.value};
 if(input.action==='top_up')input.amountAtomic=fields.amountAtomic.value;
 return action('funding-prepare',input);
});
listen($('handover-form'),'submit',async()=>{
 const f=$('handover-form').elements,row=(state.channels||state.streams).find(x=>x.streamKey===f.stream.value);
 if(!row)throw new Error('Select the original operating channel.');
 const value=await action('export',{channel:row.channel,handoverId:f.handoverId.value});
 await download(value.download,'channel-handover-'+value.sha256.slice(0,12)+'.json');
});
listen($('receive-form'),'submit',async()=>{const f=$('receive-form').elements;
 await action('receive',{bundle:await fileJSON(f.file.files[0]),dependencyRoot:f.dependencyRoot.value});});
refresh().then(()=>say('Original channel workspace ready.')).catch(error=>say(formatError(error),true));
setInterval(()=>{if(document.visibilityState==='visible')refresh().catch(error=>say(formatError(error),true));},10000);
