// MIT. Operator UI over the original authenticated host and retained native calls.
const $=id=>document.getElementById(id);
const state={token:'',host:null,profiles:[],profile:null,details:null,page:'host',tools:[],tool:null,
  definition:null,draft:null,dirty:false,offset:0,next:null,total:0,call:null,recovery:new Map(),customer:null,
  profileMode:'new',poll:null,importPacket:null};
const text=(node,value)=>{node.textContent=value??'';return node;};
const node=(tag,value,className)=>{const valueNode=document.createElement(tag);if(value!==undefined)text(valueNode,value);if(className)valueNode.className=className;return valueNode;};
const pretty=value=>JSON.stringify(value,null,2);
const bytes=value=>value<1024?value+' B':value<1024*1024?(value/1024).toFixed(1)+' KiB':(value/1024/1024).toFixed(2)+' MiB';
const when=value=>value?new Date(value).toLocaleString():'—';
const short=value=>value?value.slice(0,12)+'…':'—';
const uid=()=>crypto.randomUUID();
const annotate=(value,name)=>Boolean(value?.annotations?.[name]);
const plain=value=>Boolean(value&&typeof value==='object'&&!Array.isArray(value));
function notice(message,error=false){text($('notice'),message);$('notice').dataset.error=String(error);$('notice').hidden=!message;}
function action(button,fn){button.addEventListener('click',()=>busy(button,fn));}
async function busy(button,fn){const disabled=button.disabled;button.disabled=true;try{await fn();}catch(error){notice((error.code?error.code+': ':'')+error.message,true);}finally{button.disabled=disabled;syncControls();}}
async function api(path,{method='GET',body,raw=false}={}){
  const response=await fetch('/operator/api/'+path,{method,credentials:'same-origin',cache:'no-store',
    headers:{authorization:'Bearer '+state.token,...(body===undefined?{}:{'content-type':'application/json'})},
    ...(body===undefined?{}:{body:JSON.stringify(body)})});
  if(!response.ok){
    let packet;try{packet=await response.json();}catch{}
    const error=new Error(packet?.error?.message??packet?.error_description??'The original host returned HTTP '+response.status+'.');
    error.code=packet?.error?.code??packet?.error??'HTTP_'+response.status;
    if(response.status===401){text($('connection-state'),'Token required');$('connection-state').dataset.state='ERROR';}
    throw error;
  }
  return raw?response:response.json();
}
async function download(path,fallback){
  const response=await api(path,{raw:true}),blob=await response.blob(),url=URL.createObjectURL(blob);
  const disposition=response.headers.get('content-disposition')??'',match=/filename="([^"]+)"/.exec(disposition);
  const link=node('a');link.href=url;link.download=match?.[1]??fallback;document.body.append(link);link.click();link.remove();
  setTimeout(()=>URL.revokeObjectURL(url),30000);
  notice('Downloaded '+link.download+' · '+bytes(blob.size)+(response.headers.get('x-content-sha256')?' · SHA-256 '+response.headers.get('x-content-sha256'):''));
}
function properties(target,entries){
  target.replaceChildren();
  for(const [label,value,code] of entries){
    target.append(node('dt',label));const dd=node('dd');
    if(value instanceof Node)dd.append(value);else dd.append(node(code?'code':'span',value??'—'));
    target.append(dd);
  }
}
function tag(value){const element=node('span',value,'tag');element.dataset.state=value;return element;}
function selectionList(target,values,selected,render,choose,empty){
  target.replaceChildren();
  if(!values.length){target.append(node('p',empty,'empty'));return;}
  for(const value of values){
    const button=node('button');button.type='button';button.setAttribute('aria-current',String(selected===value.id));
    render(button,value);button.addEventListener('click',()=>busy(button,()=>choose(value)));target.append(button);
  }
}
function setPage(name){
  state.page=name;
  document.querySelectorAll('.page').forEach(value=>value.hidden=value.id!=='page-'+name);
  document.querySelectorAll('[data-page]').forEach(value=>name===value.dataset.page?value.setAttribute('aria-current','page'):value.removeAttribute('aria-current'));
}
function syncControls(){
  updateRun();
  for(const id of ['rename-profile','export-profile','native-status'])$(id).disabled=!state.profile;
  $('previous-tools').disabled=state.offset===0;$('next-tools').disabled=state.next===null;
  if(state.customer){$('resume-customer').disabled=Boolean(state.customer.active);$('pause-customer').disabled=!state.customer.active;$('download-customer').disabled=!state.customer.localFiles;}
}
function requireProfile(){if(!state.profile)throw new Error('Create or select an operator profile first.');return state.profile;}
function renderHost(){
  const host=state.host;if(!host)return;
  text($('host-name'),host.merchant);text($('connection-state'),host.operator?.closing?'Closing':'Connected');
  $('connection-state').dataset.state=host.operator?.closing?'CLOSING':'READY';
  const metrics=[
    [host.capabilities.tools,'Configured native tools'],
    [host.providers.filter(value=>value.configured).length,'Configured providers'],
    [host.providers.filter(value=>value.state==='READY').length,'Loaded providers'],
    [bytes(host.maxRequestBytes),'Native request capacity']
  ];
  $('host-metrics').replaceChildren(...metrics.map(([value,label])=>{const card=node('div',undefined,'metric');card.append(node('strong',value),node('span',label));return card;}));
  $('providers').replaceChildren(...host.providers.map(value=>{
    const row=node('tr'),name=node('td',value.name);
    if(!value.configured)name.append(node('p','Shared dependency','hint'));
    const status=node('td');status.append(tag(value.state));
    if(value.error)status.append(node('p',value.error.code+': '+value.error.message,'hint'));
    row.append(name,status,node('td',value.durationMs==null?'—':value.durationMs+' ms'),node('td',(value.dependencies??[]).join(', ')||'—'));return row;
  }));
  properties($('host-details'),[
    ['Merchant',host.merchant],['Config file',host.configuration.name],['Config SHA-256',host.configuration.sha256,true],
    ['Host binding',host.configurationFingerprint,true],['Console workspace',host.console.workspaceId,true],
    ['Accepted calls',host.operator.activeCalls],['Console calls',host.console.activeCalls],
    ['HTTP requests',host.console.activeRequests??0],['Incomplete bodies',host.console.pendingBodies??0],
    ['Customer transfers',host.console.customers?.activeDownloads??0],['Customer archives',host.console.customers?.activeArchives??0],
    ['Seller instance',host.operator.instanceId??'No seller managed by this host',true]
  ]);
  $('host-sources').replaceChildren(...(host.sources?.length?host.sources.map(value=>node('p',value.source+(value.label?' · '+value.label:''))):[node('p','No release sources configured.','hint')]));
  $('host-activity').replaceChildren(...(host.activity?.length?host.activity.map(value=>{
    const row=node('p',undefined,'hint');row.append(node('strong',value.tool),node('span',' · '+value.provider+' · '+(value.elapsedMs/1000).toFixed(1)+' s'+(value.serialized?' · host change lane':'')));return row;
  }):[node('p','No accepted native calls are active.','hint')]));
  text($('host-shutdown'),pretty(host.providerShutdown??{}));
  text($('host-json'),pretty(host));text($('footer-identity'),host.merchant+' · '+short(host.configurationFingerprint));
  const previous=$('tool-family').value;
  $('tool-family').replaceChildren(new Option('All configured providers',''),...host.capabilities.families.map(value=>new Option(value.name+' · '+value.tools,value.name)));
  $('tool-family').value=previous;
  renderBinding();
}
function renderBinding(){
  const mismatched=state.profile&&state.host&&state.profile.hostFingerprint!==state.host.configurationFingerprint;
  $('binding-panel').hidden=!mismatched;
  if(mismatched)properties($('binding-details'),[
    ['Saved profile',state.profile.name+' · revision '+state.profile.revision],
    ['Saved merchant',state.profile.host.merchant],['Saved binding',state.profile.hostFingerprint,true],
    ['Current merchant',state.host.merchant],['Current binding',state.host.configurationFingerprint,true]
  ]);
  for(const id of ['rename-profile','export-profile','native-status'])$(id).disabled=!state.profile;
  updateRun();
}
async function refreshHost(){state.host=await api('host');renderHost();}
async function loadProfiles(selectId=state.profile?.id){
  const packet=await api('profiles');state.host=packet.host;state.profiles=packet.profiles;
  $('profiles').replaceChildren(new Option('Choose a profile',''),...packet.profiles.map(value=>new Option(value.name+' · r'+value.revision,value.id)));
  const chosen=packet.profiles.find(value=>value.id===selectId)??packet.profiles[0];
  state.profile=chosen??null;$('profiles').value=chosen?.id??'';
  renderHost();await loadProfile();
}
async function loadProfile(){
  if(!state.profile){state.details={drafts:[],calls:[],deliveries:[]};renderProfile();return;}
  const packet=await api('profile/'+encodeURIComponent(state.profile.id));
  state.profile=packet.profile;state.details=packet;renderProfile();
}
function renderProfile(){
  const packet=state.details??{drafts:[],calls:[],deliveries:[]};
  text($('request-count'),packet.calls.length);text($('customer-count'),packet.deliveries.length);
  renderBinding();renderDrafts();renderCalls();renderCustomers();
  if(state.customer){const current=packet.deliveries.find(value=>value.id===state.customer.id);if(current){state.customer=current;renderCustomer();}}
  schedulePoll();
}
function schedulePoll(){
  clearTimeout(state.poll);
  if(!state.token)return;
  const pending=state.details?.calls.some(value=>value.receiving==='ACTIVE')||state.details?.deliveries.some(value=>value.active);
  if(pending)state.poll=setTimeout(async()=>{try{await Promise.all([refreshHost(),loadProfile()]);if(state.call&&state.details.calls.some(value=>value.id===state.call.id&&value.state!==state.call.state))await openCall(state.call.id,false);}catch(error){notice(error.message,true);}},1500);
}
async function connect(){
  state.token=$('access-token').value.trim();
  if(!state.token)throw new Error('Enter the original merchant access token.');
  await loadProfiles();$('connect-panel').hidden=true;$('connected').hidden=false;$('disconnect').hidden=false;
  $('access-token').value='';await loadTools();notice(state.profile?'Opened '+state.profile.name+'.':'Create a named profile to retain requests and customer receiving.');
}
function disconnect(){
  clearTimeout(state.poll);state.token='';state.host=null;state.profile=null;state.details=null;state.call=null;state.customer=null;
  $('connected').hidden=true;$('connect-panel').hidden=false;$('disconnect').hidden=true;text($('connection-state'),'Disconnected');
  $('connection-state').removeAttribute('data-state');notice('');$('access-token').value='';
  for(const id of ['call-result','call-arguments','customer-json'])$(id).textContent='';
  $('native-arguments').value='';
}
function profileForm(mode){
  state.profileMode=mode;$('profile-form').hidden=false;$('profile-name').value=mode==='rename'?requireProfile().name:'';$('profile-name').focus();
}
async function saveProfile(){
  const old=state.profileMode==='rename'?requireProfile():null;
  const packet=await api('profiles',{method:'POST',body:{...(old?{id:old.id,expectedRevision:old.revision,favorites:old.favorites}:{}),name:$('profile-name').value}});
  $('profile-form').hidden=true;state.draft=null;state.call=null;await loadProfiles(packet.profile.id);notice('Saved '+packet.profile.name+' · revision '+packet.profile.revision+'.');
}
async function bindProfile(){
  const profile=requireProfile(),packet=await api('bind',{method:'POST',body:{id:profile.id,expectedRevision:profile.revision,expectedHostFingerprint:state.host.configurationFingerprint}});
  await loadProfiles(packet.profile.id);notice('Profile revision '+packet.profile.revision+' now uses the displayed host configuration.');
}
async function importProfile(file){
  if(file.size>128*1024*1024)throw new Error('The profile archive exceeds the 128 MiB receiving capacity.');
  let packet;try{packet=JSON.parse(await file.text());}catch{throw new Error('Choose a complete operator profile JSON archive.');}
  if(packet.schema!=='stellar-forge.merchant-operator-profile.v1'||typeof packet.contentSha256!=='string')throw new Error('Choose an exported operator profile archive.');
  notice('Receiving '+file.name+' · content SHA-256 '+packet.contentSha256);
  const result=await api('import',{method:'POST',body:{archive:packet,expectedContentSha256:packet.contentSha256}});
  await loadProfiles(result.profile.id);notice((result.reused?'Reopened':'Imported')+' '+result.profile.name+' with its original saved revisions and request history.');
}
async function loadTools(){
  const params=new URLSearchParams({offset:String(state.offset),q:$('tool-search').value,family:$('tool-family').value,...($('favorites-only').checked&&state.profile?{favorites:state.profile.id}:{})});
  const packet=await api('tools?'+params);state.tools=packet.items;state.next=packet.nextOffset;state.total=packet.total;
  renderTools();
}
function renderTools(){
  const favorites=state.profile?.favorites??[];
  const items=state.tools;
  selectionList($('tool-list'),items.map(value=>({...value,id:value.name})),state.tool,(button,value)=>{
    button.append(node('strong',(favorites.includes(value.name)?'★ ':'')+value.name),node('p',value.description));
    const meta=node('div',undefined,'meta');meta.append(tag(value.family),node('span',annotate(value,'readOnlyHint')?'Read':'Change'),node('span',(value.required?.length??0)+' required inputs'));button.append(meta);
  },value=>chooseTool(value.name),state.total?'No tools on this page match the favorite filter.':'No configured tools match these filters.');
  text($('tools-total'),state.total+' native tools in this selection');text($('tools-page'),state.total?(state.offset+1)+'–'+Math.min(state.offset+75,state.total)+' of '+state.total:'0 tools');
  $('previous-tools').disabled=state.offset===0;$('next-tools').disabled=state.next===null;
}
function sample(schema,key='',depth=0){
  if(schema.default!==undefined)return schema.default;if(schema.const!==undefined)return schema.const;if(schema.enum?.length)return schema.enum[0];
  if(key==='requestId'&&schema.type==='string')return uid();
  if(schema.type==='object'||schema.properties){const value={};if(depth<3)for(const name of schema.required??[])value[name]=sample(schema.properties?.[name]??{},name,depth+1);return value;}
  if(schema.type==='array')return [];
  if(schema.type==='boolean')return false;
  if(schema.type==='integer'||schema.type==='number')return schema.minimum??0;
  return '';
}
async function chooseTool(name,{draft=null,arguments:args,recoveryOf}={}){
  const packet=await api('tool/'+encodeURIComponent(name));state.definition=packet.definition;state.tool=name;state.draft=draft;state.recoveryOf=recoveryOf??draft?.recoveryOf??null;
  $('tool-empty').hidden=true;$('tool-detail').hidden=false;text($('tool-title'),name);text($('tool-description'),packet.definition.description);
  const annotation=packet.definition.annotations??{};
  $('tool-tags').replaceChildren(tag(packet.family),tag(annotation.readOnlyHint?'Read':'Change'),
    ...(annotation.destructiveHint?[tag('Destructive change')]:[]),
    ...(annotation.idempotentHint?[tag('Native idempotency')]:[]));
  $('draft-name').value=draft?.name??name.replace(/^merchant_/,'').replaceAll('_',' ');
  $('native-arguments').value=draft?.argumentsJson?pretty(JSON.parse(draft.argumentsJson)):pretty(args??sample(packet.definition.inputSchema));
  text($('tool-schema'),pretty(packet.definition.inputSchema));text($('tool-definition'),pretty(packet.definition));
  state.dirty=!draft;updateRun();renderFavorite();renderTools();setPage('tools');
}
function updateRun(){
  if(!$('run-draft'))return;
  const bound=state.profile&&state.host&&state.profile.hostFingerprint===state.host.configurationFingerprint;
  $('run-draft').disabled=!state.draft||state.dirty||!bound||Boolean(state.host?.operator.closing);
  text($('draft-revision'),state.draft?'Revision '+state.draft.revision+(state.dirty?' · unsaved changes':' · saved'):'New draft');
  const value=$('native-arguments').value??'',size=new TextEncoder().encode(value).length;
  text($('argument-bytes'),bytes(size)+(state.host?' · host capacity '+bytes(state.host.maxRequestBytes):''));
  text($('tool-run-hint'),!state.profile?'Select an operator profile to save a request.':!bound?'Review the profile’s current host binding.':state.dirty?'Save a revision before running these native arguments.':state.draft?'Runs the saved native tool and retains its original return.':'Save a named request to begin.');
}
function argumentsValue(){
  let args;try{args=JSON.parse($('native-arguments').value);}catch(error){throw new Error('Native arguments must be complete JSON: '+error.message);}
  if(!plain(args))throw new Error('Native arguments must be a JSON object.');
  return args;
}
async function saveDraft(copy=false){
  const profile=requireProfile();if(!state.definition)throw new Error('Choose a configured native tool.');
  const old=copy?null:state.draft;
  const body={profileId:profile.id,name:$('draft-name').value,tool:state.tool,arguments:argumentsValue(),
    ...(old?{id:old.id,expectedRevision:old.revision}:{}),...(state.recoveryOf?{recoveryOf:state.recoveryOf}:{})};
  const packet=await api('drafts',{method:'POST',body});state.draft=packet.draft;state.dirty=false;
  $('native-arguments').value=pretty(JSON.parse(packet.draft.argumentsJson));await loadProfile();updateRun();notice('Saved '+packet.draft.name+' · revision '+packet.draft.revision+'.');
}
async function runDraft(){
  const profile=requireProfile(),draft=state.draft;
  if(!draft||state.dirty)throw new Error('Save the displayed revision first.');
  const callId=uid();state.pendingCall=callId;
  try{
    await api('calls',{method:'POST',body:{id:callId,profileId:profile.id,draftId:draft.id,draftRevision:draft.revision,expectedHostFingerprint:state.host.configurationFingerprint}});
    await loadProfile();await openCall(callId);notice('Accepted '+draft.tool+' with the saved native arguments.');
  }catch(error){
    try{await loadProfile();if(state.details.calls.some(value=>value.id===callId)){await openCall(callId);notice('The original request is retained. Open its current return and recovery actions.');return;}}catch{}
    throw error;
  }
}
function renderDrafts(){
  selectionList($('draft-list'),state.details?.drafts??[],state.draft?.id,(button,value)=>{
    button.append(node('strong',value.name),node('p',value.tool));const meta=node('div',undefined,'meta');meta.append(node('span','Revision '+value.revision),node('span',when(value.updatedAt)));button.append(meta);
  },value=>chooseTool(value.tool,{draft:value}),state.profile?'No saved requests yet.':'Select or create a profile.');
}
function renderFavorite(){text($('favorite-tool'),state.profile?.favorites.includes(state.tool)?'Remove favorite':'Favorite');$('favorite-tool').disabled=!state.profile;}
async function favorite(){
  const profile=requireProfile(),favorites=new Set(profile.favorites);
  favorites.has(state.tool)?favorites.delete(state.tool):favorites.add(state.tool);
  const packet=await api('profiles',{method:'POST',body:{id:profile.id,name:profile.name,expectedRevision:profile.revision,favorites:[...favorites]}});
  state.profile=packet.profile;renderFavorite();renderTools();await loadProfiles(profile.id);
}
function renderCalls(){
  selectionList($('call-list'),state.details?.calls??[],state.call?.id,(button,value)=>{
    const draft=state.details.drafts.find(item=>item.id===value.draftId);button.append(node('strong',draft?.name??value.tool),node('p',value.tool));
    const meta=node('div',undefined,'meta');meta.append(tag(value.receiving==='RETURN_PENDING'?'Return pending':value.state==='COMPLETE'?'Returned':value.state),node('span',when(value.startedAt)));button.append(meta);
  },value=>openCall(value.id),state.profile?'No native calls in this profile.':'Select or create a profile.');
}
async function openCall(id,navigate=true){
  state.call=await api('call/'+encodeURIComponent(id));const value=state.call,args=JSON.parse(value.argumentsJson);
  $('call-empty').hidden=true;$('call-detail').hidden=false;text($('call-title'),value.tool);text($('call-state'),value.receiving==='RETURN_PENDING'?'RETURN_PENDING':value.state==='COMPLETE'?'RETURNED':value.state);
  $('call-state').dataset.state=value.state;
  properties($('call-details'),[
    ['Console call ID',value.id,true],['Draft revision',value.draftId+' / '+value.draftRevision,true],
    ['Native request ID',args.requestId??args.id??'This native tool uses its displayed arguments',true],
    ['Started',when(value.startedAt)],['Returned',when(value.completedAt)],['Custody',value.custody],
    ['Request SHA-256',value.requestSha256,true],['Result SHA-256',value.resultSha256,true],['Result size',bytes(value.resultBytes)]
  ]);
  text($('call-arguments'),value.argumentsJson);
  let result=null;if(value.resultJson!==null){try{result=JSON.parse(value.resultJson);}catch{}}
  state.callResult=result;text($('call-result'),value.resultJson===null?value.error?pretty(value.error):'Waiting for the original native return.':pretty(result));
  text($('call-message'),value.receiving==='RETURN_PENDING'?'The original call is retained without an active return in this process. Use its native operation identifiers in a read or recovery tool.':value.error?value.error.code+': '+value.error.message:value.state==='COMPLETE'?'The exact returned JSON is retained for download.':'The original tool is running.');
  $('download-result').disabled=value.state!=='COMPLETE';$('reopen-draft').disabled=false;
  const selection=customerSelection(value,result);$('use-customer').hidden=!selection;state.customerSelection=selection;
  await recoveryChoices(value);
  renderCalls();if(navigate)setPage('requests');
}
async function recoveryChoices(call){
  const packet=await api('recovery/'+encodeURIComponent(call.id));state.recovery.clear();
  for(const value of packet.items)state.recovery.set(value.definition.name,{...value,kind:'Read'});
  for(const value of packet.controls??[])state.recovery.set(value.definition.name,{...value,kind:'Control'});
  $('recovery-tools').replaceChildren(...[...state.recovery].map(([name,value])=>new Option(value.kind+' · '+name,name)));
  $('recovery-panel').hidden=state.recovery.size===0;
}
async function nativeStatus(){
  const profile=requireProfile(),packet=await api('tool/merchant_status');
  const saved=await api('drafts',{method:'POST',body:{profileId:profile.id,name:'Inspect native merchant status',tool:packet.definition.name,arguments:{}}});
  await chooseTool(saved.draft.tool,{draft:saved.draft});await runDraft();
}
function customerSelection(call,result){
  const args=JSON.parse(call.argumentsJson),family=call.tool.startsWith('merchant_opensearch_deployment_')?'opensearch':call.tool.startsWith('merchant_client_export')?'core':null;
  if(!family||!result)return null;
  const values=[result,result.result,result.export,result.client,result.manifest].filter(plain);
  const exportId=args.exportId??values.map(value=>value.exportId??value.id).find(value=>typeof value==='string'&&/^[a-z0-9][a-z0-9_-]{0,63}$/.test(value));
  const sha=values.map(value=>value.manifestSha256??value.manifestSha??value.manifestFile?.sha256??value.manifest?.sha256??(value.name==='client-manifest.json'?value.sha256:undefined)).find(value=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value));
  if(!exportId||!sha)return null;
  return {family,exportId,expectedManifestSha256:sha,...(family==='opensearch'?{workspace:args.workspace}:{})};
}
function fillCustomer(value){
  $('customer-family').value=value.family;$('customer-workspace').value=value.workspace??'';$('customer-export').value=value.exportId;$('customer-sha').value=value.expectedManifestSha256;
  $('customer-workspace-field').hidden=value.family!=='opensearch';$('customer-workspace').required=value.family==='opensearch';setPage('customers');
}
async function receiveCustomer(selection){
  const profile=requireProfile(),body={profileId:profile.id,...selection,expectedHostFingerprint:state.host.configurationFingerprint};
  const packet=await api('customers',{method:'POST',body});state.customer=packet.delivery;await loadProfile();renderCustomer();notice('Receiving the reviewed original customer export '+body.exportId+'.');
}
function renderCustomers(){
  selectionList($('customer-list'),state.details?.deliveries??[],state.customer?.id,(button,value)=>{
    button.append(node('strong',value.identity.exportId),node('p',(value.identity.workspace?value.identity.workspace+' / ':'')+value.identity.family));
    const meta=node('div',undefined,'meta');meta.append(tag(value.state),node('span',when(value.updatedAt)));button.append(meta);
  },value=>{state.customer=value;renderCustomer();},state.profile?'No customer receiving records yet.':'Select or create a profile.');
}
function renderCustomer(){
  const value=state.customer;if(!value){$('customer-detail').hidden=true;return;}
  $('customer-detail').hidden=false;text($('customer-title'),value.identity.exportId);text($('customer-state'),value.state);$('customer-state').dataset.state=value.state;
  properties($('customer-details'),[
    ['Original authority',value.identity.family+(value.identity.workspace?' / '+value.identity.workspace:'')],
    ['Manifest SHA-256',value.identity.expectedManifestSha256,true],['Receiving ID',value.id,true],
    ['Started',when(value.startedAt)],['Updated',when(value.updatedAt)],['Files',value.files?.length??'Receiving'],
    ['Current custody',value.localFiles?'Complete verified local customer':value.active?'Active original transfer':'Retained receiving record']
  ]);
  const progress=value.progress;
  text($('customer-progress'),value.error?value.error.code+': '+value.error.message:progress?pretty(progress):value.state==='COMPLETE'?'Original manifest and customer files are ready.':'Resume the same reviewed export to continue its original files.');
  $('resume-customer').disabled=Boolean(value.active);$('pause-customer').disabled=!value.active;$('download-customer').disabled=!value.localFiles;
  $('customer-files').replaceChildren(...(value.files??[]).map(file=>{
    const row=node('tr'),hash=node('td');hash.append(node('code',file.sha256));const actionCell=node('td'),button=node('button','Download');
    button.disabled=!value.localFiles;action(button,()=>download('customer-file/'+encodeURIComponent(value.id)+'?'+new URLSearchParams({file:file.name}),file.name));actionCell.append(button);
    row.append(node('td',file.name),node('td',file.bytes),hash,actionCell);return row;
  }));
  text($('customer-json'),pretty(value));renderCustomers();
}
$('connect-form').addEventListener('submit',event=>{event.preventDefault();busy(event.submitter,connect);});
action($('disconnect'),disconnect);
document.querySelectorAll('[data-page]').forEach(button=>action(button,()=>setPage(button.dataset.page)));
$('profiles').addEventListener('change',async()=>{try{state.profile=state.profiles.find(value=>value.id===$('profiles').value)??null;state.draft=null;state.call=null;state.customer=null;await loadProfile();renderTools();$('call-detail').hidden=true;$('call-empty').hidden=false;renderCustomer();}catch(error){notice(error.message,true);}});
action($('new-profile'),()=>profileForm('new'));action($('rename-profile'),()=>profileForm('rename'));action($('cancel-profile'),()=>{$('profile-form').hidden=true;});
$('profile-form').addEventListener('submit',event=>{event.preventDefault();busy(event.submitter,saveProfile);});
action($('bind-profile'),bindProfile);action($('export-profile'),()=>download('export/'+encodeURIComponent(requireProfile().id),requireProfile().id+'-operator-profile.json'));
action($('import-profile'),()=>$('profile-file').click());
$('profile-file').addEventListener('change',()=>{const file=$('profile-file').files[0];if(file)busy($('import-profile'),()=>importProfile(file));$('profile-file').value='';});
action($('refresh-host'),refreshHost);action($('native-status'),nativeStatus);
$('tool-filter').addEventListener('submit',event=>{event.preventDefault();state.offset=0;busy(event.submitter,loadTools);});
action($('previous-tools'),()=>{state.offset=Math.max(0,state.offset-75);return loadTools();});
action($('next-tools'),()=>{if(state.next!==null){state.offset=state.next;return loadTools();}});
$('favorites-only').addEventListener('change',()=>{state.offset=0;busy($('tool-filter').querySelector('button'),loadTools);});
for(const id of ['draft-name','native-arguments'])$(id).addEventListener('input',()=>{state.dirty=true;updateRun();});
$('draft-form').addEventListener('submit',event=>{event.preventDefault();busy(event.submitter,()=>saveDraft());});
action($('save-copy'),()=>saveDraft(true));action($('run-draft'),runDraft);action($('favorite-tool'),favorite);
action($('refresh-requests'),async()=>{await Promise.all([refreshHost(),loadProfile()]);if(state.call)await openCall(state.call.id,false);});
action($('reopen-draft'),async()=>{const packet=await api('draft/'+encodeURIComponent(state.call.draftId)+'?revision='+state.call.draftRevision);return chooseTool(packet.draft.tool,{draft:packet.draft});});
action($('download-result'),()=>download('result/'+encodeURIComponent(state.call.id),state.call.id+'-result.json'));
action($('use-customer'),()=>fillCustomer(state.customerSelection));
action($('prepare-recovery'),async()=>{const selection=state.recovery.get($('recovery-tools').value);if(!selection)return;await chooseTool(selection.definition.name,{arguments:selection.arguments,recoveryOf:state.call.id});$('draft-name').value=selection.kind+' '+state.call.id.slice(0,8)+' · '+selection.definition.name.replace(/^merchant_/,'');notice('Prepared the original native '+selection.kind.toLowerCase()+'. Review its identifiers and save the linked draft.');});
$('customer-family').addEventListener('change',()=>{$('customer-workspace-field').hidden=$('customer-family').value!=='opensearch';$('customer-workspace').required=$('customer-family').value==='opensearch';});
$('customer-form').addEventListener('submit',event=>{event.preventDefault();busy(event.submitter,()=>receiveCustomer({family:$('customer-family').value,...($('customer-family').value==='opensearch'?{workspace:$('customer-workspace').value}:{}),exportId:$('customer-export').value,expectedManifestSha256:$('customer-sha').value}));});
action($('refresh-customers'),()=>loadProfile());
action($('resume-customer'),()=>receiveCustomer(state.customer.identity));
action($('pause-customer'),async()=>{await api('customer-pause',{method:'POST',body:{id:state.customer.id}});await loadProfile();notice('Pause requested at the original receiving checkpoint.');});
action($('download-customer'),()=>download('customer-archive/'+encodeURIComponent(state.customer.id),state.customer.identity.exportId+'.tar.gz'));
const bootstrap=new URLSearchParams(location.hash.slice(1)).get('token');
if(bootstrap){history.replaceState(null,'',location.pathname+location.search);$('access-token').value=bootstrap;busy($('connect-form').querySelector('button'),connect);}
