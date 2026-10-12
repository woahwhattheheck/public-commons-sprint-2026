// MIT. Operator UI over the original authenticated host and retained native calls.
import { createWorkflowPage } from './workflows.mjs';
import {createReviewerCustomerPage,reviewerCustomerSelection} from './customer-reviewer.mjs';
import {createGrpcCustomerPage,grpcCustomerSelection} from './customer-grpc.mjs';
const $=id=>document.getElementById(id);
const state={token:'',host:null,profiles:[],profile:null,details:null,page:'host',tools:[],tool:null,
  definition:null,draft:null,dirty:false,offset:0,next:null,total:0,call:null,recovery:new Map(),customer:null,
  profileMode:'new',poll:null,polling:false,pollDelay:1500,sessionEpoch:0,profileEpoch:0,callOpenSeq:0,toolOpenSeq:0,importPacket:null,review:null,reviewProfileId:null,reviewBaseline:'',reviewOffset:0,reviewOpenSeq:0};
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
async function api(path,{method='GET',body,raw=false,epoch=state.sessionEpoch}={}){
  if(epoch!==state.sessionEpoch)throw new Error('The operator connection changed. Reopen this original action in its saved profile.');
  const response=await fetch('/operator/api/'+path,{method,credentials:'same-origin',cache:'no-store',
    headers:{authorization:'Bearer '+state.token,...(body===undefined?{}:{'content-type':'application/json'})},
    ...(body===undefined?{}:{body:JSON.stringify(body)})});
  if(!response.ok){
    let packet;try{packet=await response.json();}catch{}
    const error=new Error(packet?.error?.message??packet?.error_description??'The original host returned HTTP '+response.status+'.');
    error.status=response.status;
    error.code=packet?.error?.code??packet?.error??'HTTP_'+response.status;
    if(response.status===401&&epoch===state.sessionEpoch){text($('connection-state'),'Token required');$('connection-state').dataset.state='ERROR';}
    throw error;
  }
  return raw?response:response.json();
}
async function download(path,fallback,{stream=false,maximumBytes=null}={}){
  const selectedContext=()=>JSON.stringify({session:state.sessionEpoch,profileEpoch:state.profileEpoch,
    profile:state.profile?.id,profileHost:state.profile?.hostFingerprint,host:state.host?.configurationFingerprint,
    composition:state.host?.composition?.fingerprint,consoleId:state.host?.console.workspaceId});
  const original=selectedContext(),epoch=state.sessionEpoch;
  const check=()=>{if(original!==selectedContext())throw new Error('The selected operator changed. Start the download again from its original customer record.');};
  const memoryLimit=16*1024*1024;
  const receiverMessage='For this complete large file, use a browser with direct file saving or the resumable native receiving command shown with the gRPC manifest.';
  if(stream&&typeof window.showSaveFilePicker==='function'){
    // Pick the receiving file during the click, before awaiting the authenticated request.
    let selected;
    try{selected=await window.showSaveFilePicker({suggestedName:fallback});}
    catch(error){if(error.name==='AbortError')return;throw error;}
    check();const response=await api(path,{raw:true,epoch});
    let writable;
    try{
      check();if(!response.body)throw new Error('The original file response has no receiving stream.');
      writable=await selected.createWritable();check();
      await response.body.pipeTo(writable);writable=null;
    }catch(error){
      if(writable)try{await writable.abort();}catch{}
      try{await response.body?.cancel();}catch{}
      throw error;
    }
    notice('Saved '+selected.name+(response.headers.get('x-content-sha256')?' · SHA-256 '+response.headers.get('x-content-sha256'):''));return;
  }
  if(stream&&Number.isSafeInteger(maximumBytes)&&maximumBytes>memoryLimit)throw new Error(receiverMessage);
  check();const response=await api(path,{raw:true,epoch});let blob;
  try{
    check();
    if(stream){
      if(!response.body)throw new Error('The original file response has no receiving stream.');
      const length=response.headers.get('content-length');
      if(length&&Number(length)>memoryLimit)throw new Error(receiverMessage);
      const reader=response.body.getReader(),chunks=[];let size=0;
      try{while(true){const packet=await reader.read();if(packet.done)break;
        size+=packet.value.byteLength;if(size>memoryLimit)throw new Error(receiverMessage);chunks.push(packet.value);}}
      catch(error){try{await reader.cancel();}catch{}throw error;}
      finally{reader.releaseLock();}
      blob=new Blob(chunks,{type:response.headers.get('content-type')??'application/octet-stream'});
    }else blob=await response.blob();
    check();
  }catch(error){try{await response.body?.cancel();}catch{}throw error;}
  const url=URL.createObjectURL(blob),disposition=response.headers.get('content-disposition')??'',match=/filename="([^"]+)"/.exec(disposition);
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
  updateRun();workflowPage.sync();reviewerPage.sync();grpcPage.sync();
  for(const id of ['rename-profile','export-profile','native-status','review-host'])$(id).disabled=!state.profile;
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
  const declarations=new Map((host.composition?.providers??[]).map(value=>[value.family,value]));
  $('providers').replaceChildren(...host.providers.map(value=>{
    const row=node('tr'),name=node('td',value.name);
    if(!value.configured)name.append(node('p','Shared dependency','hint'));
    const declaration=declarations.get(value.name);
    if(declaration) {
      const details=node('details'),content=node('dl',undefined,'properties');
      details.append(node('summary','Declaration '+short(declaration.source.sha256)));
      properties(content,[['Title',declaration.title],['Source file',declaration.source.path,true],
        ['Declaration SHA-256',declaration.source.sha256,true],['Host input',declaration.configurationInput??'Common host'],
        ['Request capacity',bytes(declaration.maxRequestBytes)],['Concurrency',declaration.concurrency],
        ['Shutdown',declaration.shutdown],['Concurrent controls',declaration.concurrentTools.join(', ')||'—']]);
      details.append(content);name.append(details);
    }
    const status=node('td');status.append(tag(value.state));
    if(value.error)status.append(node('p',value.error.code+': '+value.error.message,'hint'));
    row.append(name,status,node('td',value.durationMs==null?'—':value.durationMs+' ms'),node('td',(value.dependencies??[]).join(', ')||'—'));return row;
  }));
  properties($('host-details'),[
    ['Merchant',host.merchant],['Config file',host.configuration.name],['Config SHA-256',host.configuration.sha256,true],
    ['Host binding',host.configurationFingerprint,true],['Console workspace',host.console.workspaceId,true],
    ['Tool catalog',host.composition?.catalogSha256??'Available after host upgrade',true],
    ['Provider declarations',host.composition?.registrySha256??'Available after host upgrade',true],
    ['Installed source commit',host.composition?.sourceCommit??'Checkout declaration identities',true],
    ['Accepted calls',host.operator.activeCalls],['Console calls',host.console.activeCalls],['Active workflows',host.console.workflows?.activeRuns??0],
    ['Customer transfers',host.console.customers?.activeDownloads??0],['Customer archives',host.console.customers?.activeArchives??0],
    ['HTTP requests',host.console.activeRequests??0],['Incomplete bodies',host.console.pendingBodies??0],
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
  for(const id of ['rename-profile','export-profile','native-status','review-host'])$(id).disabled=!state.profile;
  updateRun();
}
async function refreshHost(){const epoch=state.sessionEpoch,host=await api('host',{epoch});if(epoch!==state.sessionEpoch)return;state.host=host;grpcPage.profileChanged();renderHost();}
async function loadProfiles(selectId=state.profile?.id){
  const epoch=state.sessionEpoch,selection=state.profileEpoch,packet=await api('profiles',{epoch});
  if(epoch!==state.sessionEpoch||selection!==state.profileEpoch)return;state.host=packet.host;state.profiles=packet.profiles;
  $('profiles').replaceChildren(new Option('Choose a profile',''),...packet.profiles.map(value=>new Option(value.name+' · r'+value.revision,value.id)));
  const chosen=packet.profiles.find(value=>value.id===selectId)??packet.profiles[0];
  if(state.profile?.id!==chosen?.id)state.profileEpoch++;
  state.profile=chosen??null;$('profiles').value=chosen?.id??'';
  workflowPage.profileChanged();reviewerPage.profileChanged();grpcPage.profileChanged();
  renderHost();await loadProfile();
}
async function loadProfile(){
  if(!state.profile){state.details={drafts:[],calls:[],deliveries:[]};renderProfile();workflowPage.profileChanged();reviewerPage.profileChanged();grpcPage.profileChanged();return;}
  const epoch=state.sessionEpoch,selection=state.profileEpoch,profileId=state.profile.id;
  const packet=await api('profile/'+encodeURIComponent(profileId),{epoch});
  if(epoch!==state.sessionEpoch||selection!==state.profileEpoch||state.profile?.id!==profileId)return;
  state.profile=packet.profile;state.details=packet;
  if(state.review&&state.review.profile.revision!==state.profile.revision)state.review=null;
  renderProfile();await workflowPage.refresh();schedulePoll();
}
function renderProfile(){
  const packet=state.details??{drafts:[],calls:[],deliveries:[]};
  text($('request-count'),packet.calls.length);text($('customer-count'),packet.deliveries.length);
  renderBinding();renderDrafts();renderCalls();renderCustomers();renderReviewBindings();workflowPage.profileChanged();reviewerPage.profileChanged();grpcPage.profileChanged();
  if(state.customer){const current=packet.deliveries.find(value=>value.id===state.customer.id);if(current){state.customer=current;renderCustomer();}}
  schedulePoll();
}
function schedulePoll(){
  if(state.polling)return;
  clearTimeout(state.poll);
  if(!state.token)return;
  const pending=workflowPage.hasActive||reviewerPage.hasActive||grpcPage.hasActive||state.details?.calls.some(value=>value.receiving==='ACTIVE')||state.details?.deliveries.some(value=>value.active);
  if(pending)state.poll=setTimeout(async()=>{
    state.polling=true;const epoch=state.sessionEpoch,profileId=state.profile?.id;
    try{
      await Promise.all([refreshHost(),loadProfile()]);
      if(epoch===state.sessionEpoch&&profileId===state.profile?.id&&state.call&&state.details.calls.some(value=>value.id===state.call.id&&value.state!==state.call.state))await openCall(state.call.id,false);
      state.pollDelay=1500;
    }catch(error){if(epoch===state.sessionEpoch)notice(error.message,true);state.pollDelay=Math.min(30000,state.pollDelay*2);}
    finally{state.polling=false;schedulePoll();}
  },state.pollDelay);
}
async function connect(){
  const epoch=++state.sessionEpoch;state.profileEpoch++;state.pollDelay=1500;
  state.token=$('access-token').value.trim();
  if(!state.token)throw new Error('Enter the original merchant access token.');
  await loadProfiles();if(epoch!==state.sessionEpoch)return;$('connect-panel').hidden=true;$('connected').hidden=false;$('disconnect').hidden=false;
  $('access-token').value='';await loadTools();notice(state.profile?'Opened '+state.profile.name+'.':'Create a named profile to retain requests and customer receiving.');
}
function disconnect(){
  state.sessionEpoch++;state.profileEpoch++;
  clearTimeout(state.poll);state.token='';state.host=null;state.profile=null;state.details=null;state.call=null;state.customer=null;
  state.review=null;state.reviewProfileId=null;state.reviewBaseline='';state.reviewOpenSeq++;
  $('connected').hidden=true;$('connect-panel').hidden=false;$('disconnect').hidden=true;text($('connection-state'),'Disconnected');
  $('connection-state').removeAttribute('data-state');notice('');$('access-token').value='';
  for(const id of ['call-result','call-arguments','customer-json'])$(id).textContent='';
  $('native-arguments').value='';workflowPage.reset();reviewerPage.reset();grpcPage.reset();
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
  const profile=requireProfile(),epoch=state.sessionEpoch,selection=state.profileEpoch;
  const packet=await api('bind',{method:'POST',epoch,body:{id:profile.id,expectedRevision:profile.revision,
    expectedHostFingerprint:state.host.configurationFingerprint,
    ...(state.host.composition?{expectedCompositionFingerprint:state.host.composition.fingerprint}:{})}});
  if(epoch!==state.sessionEpoch||selection!==state.profileEpoch||state.profile?.id!==profile.id)return;
  state.review=null;state.reviewBaseline='';
  await loadProfiles(packet.profile.id);
  if(epoch!==state.sessionEpoch||state.profile?.id!==profile.id)return;
  await loadHostReview();
  if(epoch!==state.sessionEpoch||state.profile?.id!==profile.id)return;
  notice('Saved host binding at profile revision '+packet.profile.revision+'. Earlier bindings, native requests and customer records remain in this profile.');
}
async function adoptReviewedHost(){
  const profile=requireProfile(),review=state.review,epoch=state.sessionEpoch,selection=state.profileEpoch;
  if(!review||review.profile.id!==profile.id||review.profile.revision!==profile.revision)
    throw new Error('Refresh the selected profile and review its current host before adopting it.');
  const packet=await api('bind',{method:'POST',epoch,body:{id:review.profile.id,expectedRevision:review.profile.revision,
    expectedHostFingerprint:review.after.configurationFingerprint,
    ...(review.after.compositionFingerprint?{expectedCompositionFingerprint:review.after.compositionFingerprint}:{})}});
  if(epoch!==state.sessionEpoch||selection!==state.profileEpoch||state.profile?.id!==profile.id)return;
  state.review=null;state.reviewBaseline='';
  await loadProfiles(packet.profile.id);
  if(epoch!==state.sessionEpoch||state.profile?.id!==profile.id)return;
  await loadHostReview();
  if(epoch!==state.sessionEpoch||state.profile?.id!==profile.id)return;
  notice('Saved the reviewed host binding at profile revision '+packet.profile.revision+'. Earlier bindings, native requests and customer records remain in this profile.');
}
function reviewPath(download=false) {
  const profile=requireProfile(),query=new URLSearchParams();
  if(state.reviewBaseline)query.set('revision',state.reviewBaseline);
  if(download)query.set('download','1');
  return 'host-review/'+encodeURIComponent(profile.id)+(query.size?'?'+query:'');
}
function renderReviewBindings() {
  $('host-review-panel').hidden=!state.profile;
  if(!state.profile)return;
  if(state.reviewProfileId!==state.profile.id) {
    state.reviewProfileId=state.profile.id;state.review=null;state.reviewBaseline='';state.reviewOffset=0;state.reviewOpenSeq++;
  }
  const history=state.details?.bindings??[];
  if(state.reviewBaseline&&!history.some(value=>String(value.revision)===state.reviewBaseline))state.reviewBaseline='';
  $('review-binding').replaceChildren(new Option('Current saved binding',''),
    ...history.map(value=>new Option('Revision '+value.revision+' · '+when(value.recordedAt)+' · '+value.merchant,String(value.revision))));
  $('review-binding').value=state.reviewBaseline;
  text($('binding-history-count'),history.length+' retained host '+(history.length===1?'binding':'bindings'));
  $('binding-history').replaceChildren(...history.map(value=>{
    const row=node('tr');
    row.append(node('td',value.revision),node('td',when(value.recordedAt)),node('td',value.origin.replaceAll('_',' ').toLowerCase()),
      node('td',value.toolCount??'—'),node('td',short(value.hostFingerprint)));
    const target=node('td'),button=node('button','Compare');button.type='button';
    action(button,async()=>{state.reviewBaseline=String(value.revision);$('review-binding').value=state.reviewBaseline;await loadHostReview();});
    target.append(button);row.append(target);return row;
  }));
  renderHostReview();
}
async function loadHostReview() {
  const profileId=requireProfile().id,epoch=state.sessionEpoch,selection=state.profileEpoch,
    sequence=++state.reviewOpenSeq,path=reviewPath();
  const current=()=>epoch===state.sessionEpoch&&selection===state.profileEpoch&&
    state.profile?.id===profileId&&sequence===state.reviewOpenSeq;
  await refreshHost();if(!current())return;
  const review=await api(path,{epoch});if(!current())return;
  state.review=review;state.reviewOffset=0;renderHostReview();
}
function hostReviewRows(review) {
  const rows=[];
  const include=(value,group,key)=>{
    for(const after of value.added)rows.push({group,change:'Added',name:after[key],before:null,after});
    for(const before of value.removed)rows.push({group,change:'Removed',name:before[key],before,after:null});
    for(const value of value.changed)rows.push({group,change:'Changed',name:value[key],before:value.before,after:value.after,fields:value.fields});
  };
  if(review.configurationChanged)rows.push({group:'Configuration',change:'Changed',name:'Host binding',
    before:review.before.configurationFingerprint,after:review.after.configurationFingerprint});
  if(review.requestCapacity.changed)rows.push({group:'Capacity',change:'Changed',name:'Native request bytes',
    before:review.requestCapacity.before,after:review.requestCapacity.after});
  include(review.tools,'Tools','name');include(review.providers,'Providers','family');include(review.sourceBindings,'Sources','source');
  if(review.tools.coverage!=='COMPLETE'&&review.tools.before!==review.tools.after)
    rows.push({group:'Tools',change:'Count changed',name:'Configured tool count',before:review.tools.before,after:review.tools.after});
  return rows;
}
function renderHostReview() {
  const review=state.review;
  $('host-review-empty').hidden=Boolean(review);$('host-review-content').hidden=!review;
  $('export-host-review').disabled=!review;$('adopt-host-snapshot').disabled=!review||!state.profile||review.profile.id!==state.profile.id||review.profile.revision!==state.profile.revision;
  if(!review)return;
  text($('host-review-state'),review.state.replaceAll('_',' '));
  $('host-review-state').dataset.state=review.state;
  text($('host-review-scope'),review.scope.baseline);
  const changes=value=>value.added.length+value.removed.length+value.changed.length;
  const metrics=[
    [review.configurationChanged?'Changed':'Unchanged','Host configuration'],
    [review.complete?changes(review.tools):'Counts available','Tool definitions'],
    [changes(review.providers),'Provider changes'],
    [bytes(review.requestCapacity.before)+' → '+bytes(review.requestCapacity.after),'Request capacity']
  ];
  $('review-metrics').replaceChildren(...metrics.map(([value,label])=>{
    const item=node('div',undefined,'metric');item.append(node('strong',value),node('span',label));return item;
  }));
  const show=(target,value)=>properties(target,[
    ['Merchant',value.merchant],['Configured tools',value.toolCount],['Host binding',value.configurationFingerprint,true],
    ['Composition',value.compositionFingerprint??'Earlier profile snapshot',true],['Source commit',value.sourceCommit??'Checkout declaration identities',true]
  ]);
  show($('review-before'),review.before);show($('review-after'),review.after);
  const query=$('review-search').value.toLowerCase(),group=$('review-category').value;
  const all=hostReviewRows(review),rows=all.filter(value=>(!group||value.group===group)&&
    (!query||[value.group,value.change,value.name,...(value.fields??[])].join(' ').toLowerCase().includes(query)));
  if(state.reviewOffset>=rows.length)state.reviewOffset=0;
  const page=rows.slice(state.reviewOffset,state.reviewOffset+50);
  $('review-changes').replaceChildren(...page.map(value=>{
    const row=node('tr'),description=node('td'),detail=node('details');
    detail.append(node('summary',value.fields?.join(', ')||'Retained values'),node('pre',pretty({before:value.before,after:value.after})));
    description.append(detail);
    if(value.group==='Tools'&&value.after) {
      const button=node('button','Open current tool');button.type='button';
      action(button,()=>chooseTool(value.name));description.append(button);
    }
    row.append(node('td',value.group),node('td',value.change),node('td',value.name,'break'),description);return row;
  }));
  $('review-no-changes').hidden=page.length>0;
  text($('review-no-changes'),all.length?'No changes match these filters.':review.complete?
    'The saved configuration, tool definitions and provider declarations match this host.':
    'Available saved values match. Save this host binding to retain the complete current tool and declaration snapshot.');
  text($('review-page'),rows.length?'Showing '+(state.reviewOffset+1)+'–'+(state.reviewOffset+page.length)+' of '+rows.length:'0 changes');
  $('previous-review').disabled=state.reviewOffset===0;$('next-review').disabled=state.reviewOffset+50>=rows.length;
  text($('host-review-json'),pretty(review));
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
  const epoch=state.sessionEpoch,selection=state.profileEpoch,sequence=++state.toolOpenSeq;
  const packet=await api('tool/'+encodeURIComponent(name),{epoch});if(epoch!==state.sessionEpoch||selection!==state.profileEpoch||sequence!==state.toolOpenSeq)return;
  state.definition=packet.definition;state.tool=name;state.draft=draft;state.recoveryOf=recoveryOf??draft?.recoveryOf??null;
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
  const epoch=state.sessionEpoch,selection=state.profileEpoch,toolSequence=state.toolOpenSeq,
    selectedDraftId=state.draft?.id??null,name=$('draft-name').value,argumentText=$('native-arguments').value;
  const current=()=>epoch===state.sessionEpoch&&selection===state.profileEpoch&&state.profile?.id===profile.id;
  const old=copy?null:state.draft;
  const body={profileId:profile.id,name,tool:state.tool,arguments:argumentsValue(),
    ...(old?{id:old.id,expectedRevision:old.revision}:{}),...(state.recoveryOf?{recoveryOf:state.recoveryOf}:{})};
  const packet=await api('drafts',{method:'POST',body,epoch});if(!current())return;
  if(toolSequence===state.toolOpenSeq&&(state.draft?.id??null)===selectedDraftId&&
      $('draft-name').value===name&&$('native-arguments').value===argumentText){
    state.draft=packet.draft;state.dirty=false;
    $('native-arguments').value=pretty(JSON.parse(packet.draft.argumentsJson));
  }
  await loadProfile();if(!current())return;
  updateRun();notice('Saved '+packet.draft.name+' · revision '+packet.draft.revision+'.');
}
async function runDraft(){
  const profile=requireProfile(),draft=state.draft,epoch=state.sessionEpoch,selection=state.profileEpoch;
  const current=()=>epoch===state.sessionEpoch&&selection===state.profileEpoch&&state.profile?.id===profile.id;
  if(!draft||state.dirty)throw new Error('Save the displayed revision first.');
  const callId=uid();state.pendingCall=callId;
  try{
    await api('calls',{method:'POST',epoch,body:{id:callId,profileId:profile.id,draftId:draft.id,draftRevision:draft.revision,expectedHostFingerprint:state.host.configurationFingerprint}});
    if(!current())return;
    await loadProfile();if(!current())return;
    await openCall(callId);if(current())notice('Accepted '+draft.tool+' with the saved native arguments.');
  }catch(error){
    if(!current())return;
    try{
      await loadProfile();if(!current())return;
      if(state.details.calls.some(value=>value.id===callId)){
        await openCall(callId);if(current())notice('The original request is retained. Open its current return and recovery actions.');
        return;
      }
    }catch{}
    if(current())throw error;
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
  const epoch=state.sessionEpoch,profileSelection=state.profileEpoch,sequence=navigate?++state.callOpenSeq:state.callOpenSeq;
  const selected=await api('call/'+encodeURIComponent(id),{epoch});
  if(epoch!==state.sessionEpoch||profileSelection!==state.profileEpoch||sequence!==state.callOpenSeq||!navigate&&state.call?.id!==id)return;
  state.call=selected;const value=state.call,args=JSON.parse(value.argumentsJson);
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
  if(!await recoveryChoices(value,{epoch,profileSelection,sequence}))return;
  if(epoch!==state.sessionEpoch||profileSelection!==state.profileEpoch||sequence!==state.callOpenSeq||state.call?.id!==id)return;
  renderCalls();if(navigate)setPage('requests');
}
async function recoveryChoices(call,{epoch,profileSelection,sequence}){
  const packet=await api('recovery/'+encodeURIComponent(call.id),{epoch});
  if(epoch!==state.sessionEpoch||profileSelection!==state.profileEpoch||sequence!==state.callOpenSeq||state.call?.id!==call.id)return false;
  state.recovery.clear();
  for(const value of packet.items)state.recovery.set(value.definition.name,{...value,kind:'Read'});
  for(const value of packet.controls??[])state.recovery.set(value.definition.name,{...value,kind:'Control'});
  $('recovery-tools').replaceChildren(...[...state.recovery].map(([name,value])=>new Option(value.kind+' · '+name,name)));
  $('recovery-panel').hidden=state.recovery.size===0;
  return true;
}
async function nativeStatus(){
  const profile=requireProfile(),epoch=state.sessionEpoch,selection=state.profileEpoch;
  const current=()=>epoch===state.sessionEpoch&&selection===state.profileEpoch&&state.profile?.id===profile.id;
  const packet=await api('tool/merchant_status',{epoch});if(!current())return;
  const saved=await api('drafts',{method:'POST',epoch,body:{profileId:profile.id,name:'Inspect native merchant status',tool:packet.definition.name,arguments:{}}});
  if(!current())return;
  await chooseTool(saved.draft.tool,{draft:saved.draft});
  if(!current()||state.draft?.id!==saved.draft.id||state.tool!==saved.draft.tool)return;
  await runDraft();
}
function customerFamily(call){
  if(call?.tool?.startsWith('merchant_grpc_'))return 'grpc';
  if(call?.tool?.startsWith('merchant_grant_reviewer_'))return 'grant-reviewer';
  if(['merchant_openapi_export','merchant_openapi_manifest'].includes(call?.tool))return 'openapi';
  if(call?.tool?.startsWith('merchant_opensearch_deployment_'))return 'opensearch';
  if(call?.tool?.startsWith('merchant_client_export'))return 'core';
  return null;
}
const customerAuthority=family=>({core:'Merchant release store',opensearch:'OpenSearch workspace deployment',openapi:'API workspace package','grant-reviewer':'Grant reviewer packet and results',grpc:'gRPC customer, source and observations'}[family]??family);
const customerWorkspace=family=>['opensearch','openapi','grant-reviewer','grpc'].includes(family);
const customerCallReady=call=>call?.state==='COMPLETE'&&Boolean(customerFamily(call));
function customerResults(result){
  const queue=[result],seen=new Set(),values=[];
  while(queue.length){
    const value=queue.shift();
    if(!plain(value)||seen.has(value))continue;seen.add(value);values.push(value);
    for(const key of ['result','structuredContent','export','client','manifest','delivery'])if(plain(value[key]))queue.push(value[key]);
    for(const item of (Array.isArray(value.content)?value.content:[]))if(item?.type==='text'&&typeof item.text==='string'){
      try{const decoded=JSON.parse(item.text);if(plain(decoded))queue.push(decoded);}catch{}
    }
  }
  return values;
}
function customerSelection(call,result){
  if(call?.state!=='COMPLETE'||!result||result.isError===true)return null;
  if(call.tool?.startsWith('merchant_grpc_'))return grpcCustomerSelection(call,result);
  const reviewer=reviewerCustomerSelection(call,result);if(reviewer)return reviewer;
  const family=customerFamily(call);
  if(!family||call.state!=='COMPLETE'||!result||result.isError===true)return null;
  const args=JSON.parse(call.argumentsJson),values=customerResults(result);
  if(values.some(value=>value.isError===true))return null;
  if(family==='openapi'){
    const packet=values.find(value=>['EXPORTED','MANIFEST_RETAINED'].includes(value.state)&&
      value.manifest?.schema==='stellar-forge.api-merchant-package-export.v1'&&
      value.manifest.exportId===value.exportId&&/^[a-f0-9]{64}$/.test(value.exportId??'')&&
      value.manifestFile?.name==='package-export.json'&&/^[a-f0-9]{64}$/.test(value.manifestFile.sha256??''));
    if(!packet||args.exportId!==undefined&&args.exportId!==packet.exportId)return null;
    const workspace=args.workspace??packet.workspace;
    if(!/^[a-z0-9][a-z0-9_-]{0,63}$/.test(workspace??'')||
      packet.workspace!==undefined&&packet.workspace!==workspace)return null;
    return{family,workspace,exportId:packet.exportId,expectedManifestSha256:packet.manifestFile.sha256};
  }
  const exportId=args.exportId??values.map(value=>value.exportId??value.id).find(value=>typeof value==='string'&&/^[a-z0-9][a-z0-9_-]{0,63}$/.test(value));
  const sha=values.map(value=>value.manifestSha256??value.manifestSha??value.manifestFile?.sha256??value.manifest?.sha256??(value.name==='client-manifest.json'?value.sha256:undefined)).find(value=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value));
  if(!exportId||!sha)return null;
  return {family,exportId,expectedManifestSha256:sha,...(family==='opensearch'?{workspace:args.workspace}:{})};
}
function customerFormRules(){
  const family=$('customer-family').value,workspace=customerWorkspace(family),apiPackage=family==='openapi',reviewer=family==='grant-reviewer',exactSha=apiPackage||reviewer||family==='grpc';
  $('customer-workspace-field').hidden=!workspace;$('customer-workspace').required=workspace;
  $('customer-workspace').pattern=reviewer?'[A-Za-z0-9][A-Za-z0-9._-]{0,127}':'[a-z0-9][a-z0-9_-]{0,63}';
  $('customer-workspace').maxLength=reviewer?128:64;
  $('customer-export').pattern=exactSha?'[a-f0-9]{64}':'[a-z0-9][a-z0-9_-]{0,63}';
  $('customer-export').maxLength=64;
  $('customer-export').title=exactSha?'Use the exact 64-character original export ID.':'Use the original export ID.';
  text($('customer-form-hint'),apiPackage?
    'Use the API workspace alias and the full package-export.json digest returned by Export or Manifest. The internal package manifest has its own separate digest.':
    reviewer?'Use the configured reviewer workbench alias, exact export ID and complete manifest digest returned by the original export.':
    family==='grpc'?'Use the configured gRPC workspace, complete export ID and grpc-workspace-export.json digest. The archive restores the original nested client paths.':
    'Use the export identity and manifest digest returned by the original merchant.');
}
function fillCustomer(value){
  if(!value)throw new Error('Open a completed export or manifest request first.');
  requireProfile();
  $('customer-family').value=value.family;$('customer-workspace').value=value.workspace??'';
  $('customer-export').value=value.exportId;$('customer-sha').value=value.expectedManifestSha256;
  customerFormRules();setPage('customers');$('customer-export').focus();
}
async function prepareCustomer(callId,{isCurrent=()=>true}={}){
  const profile=requireProfile(),epoch=state.sessionEpoch,selection=state.profileEpoch;
  const current=()=>epoch===state.sessionEpoch&&selection===state.profileEpoch&&state.profile?.id===profile.id&&isCurrent();
  const call=await api('call/'+encodeURIComponent(callId),{epoch});
  if(!current())return;
  if(call.profileId!==profile.id||call.state!=='COMPLETE'||call.resultJson===null)
    throw new Error('Open a completed export in this operator profile.');
  let result;try{result=JSON.parse(call.resultJson);}catch{throw new Error('Open the original saved export result.');}
  const customer=customerSelection(call,result);
  if(!customer)throw new Error('This request does not retain a complete customer export identity. Open its original Export or Manifest result.');
  fillCustomer(customer);
  notice('Prepared '+customerAuthority(customer.family)+' from request '+call.id+'. Review the displayed original export and receive its complete files.');
}
async function receiveCustomer(selection){
  const profile=requireProfile(),epoch=state.sessionEpoch,profileSelection=state.profileEpoch,customerId=state.customer?.id??null;
  const current=()=>epoch===state.sessionEpoch&&profileSelection===state.profileEpoch&&state.profile?.id===profile.id;
  const body={profileId:profile.id,family:selection.family,exportId:selection.exportId,
    expectedManifestSha256:selection.expectedManifestSha256,...(customerWorkspace(selection.family)?{workspace:selection.workspace}:{}),
    expectedHostFingerprint:state.host.configurationFingerprint};
  const packet=await api('customers',{method:'POST',body,epoch});if(!current())return;
  if((state.customer?.id??null)===customerId)state.customer=packet.delivery;
  await loadProfile();if(!current())return;
  renderCustomer();notice('Receiving the reviewed original '+(body.family==='openapi'?'API package ':'customer export ')+body.exportId+'.');
}
function renderCustomers(){
  selectionList($('customer-list'),state.details?.deliveries??[],state.customer?.id,(button,value)=>{
    button.append(node('strong',value.identity.exportId),node('p',customerAuthority(value.identity.family)+(value.identity.workspace?' / '+value.identity.workspace:'')));
    const meta=node('div',undefined,'meta');meta.append(tag(value.state),node('span',when(value.updatedAt)));button.append(meta);
  },value=>{state.customer=value;renderCustomer();},state.profile?'No customer receiving records yet.':'Select or create a profile.');
}
function renderCustomer(){
  const value=state.customer;if(!value){$('customer-detail').hidden=true;return;}
  $('customer-detail').hidden=false;text($('customer-title'),value.identity.exportId);text($('customer-state'),value.state);$('customer-state').dataset.state=value.state;
  properties($('customer-details'),[
    ['Original authority',customerAuthority(value.identity.family)+(value.identity.workspace?' / '+value.identity.workspace:'')],
    ['Manifest SHA-256',value.identity.expectedManifestSha256,true],['Receiving ID',value.id,true],
    ['Started',when(value.startedAt)],['Updated',when(value.updatedAt)],['Files',value.files?.length??'Receiving'],
    ['Total file bytes',value.files?value.files.reduce((total,file)=>total+file.bytes,0).toLocaleString():'Receiving'],
    ['Current custody',value.localFiles?'Complete verified local customer':value.active?'Active original transfer':'Retained receiving record']
  ]);
  $('customer-openapi-guidance').hidden=value.identity.family!=='openapi';
  text($('download-customer'),value.identity.family==='openapi'?'Download original API package archive':'Download original customer archive');
  const progress=value.progress;
  text($('customer-progress'),value.error?value.error.code+': '+value.error.message:progress?pretty(progress):value.state==='COMPLETE'?'Original manifest and customer files are ready.':'Resume the same reviewed export to continue its original files.');
  $('resume-customer').disabled=Boolean(value.active);$('pause-customer').disabled=!value.active;$('download-customer').disabled=!value.localFiles;
  $('customer-files').replaceChildren(...(value.files??[]).map(file=>{
    const row=node('tr'),hash=node('td');hash.append(node('code',file.sha256));const actionCell=node('td'),button=node('button','Download');
    button.disabled=!value.localFiles;action(button,()=>download('customer-file/'+encodeURIComponent(value.id)+'?'+new URLSearchParams({file:file.name}),file.name,{stream:value.identity.family==='grpc',maximumBytes:file.bytes}));actionCell.append(button);
    row.append(node('td',file.path??file.name),node('td',file.bytes),hash,actionCell);return row;
  }));
  text($('customer-json'),pretty(value));
  if(value.identity.family==='grant-reviewer')text($('download-customer'),value.manifest?.kind==='reviewer-packet'?'Download original receiving packet':'Download complete original file');
  else text($('download-customer'),value.identity.family==='grpc'?'Download complete gRPC archive':value.identity.family==='openapi'?'Download original API package archive':'Download original customer archive');
  renderCustomers();reviewerPage.sync();grpcPage.sync();
}
$('connect-form').addEventListener('submit',event=>{event.preventDefault();busy(event.submitter,connect);});
action($('disconnect'),disconnect);
document.querySelectorAll('[data-page]').forEach(button=>action(button,()=>setPage(button.dataset.page)));
$('profiles').addEventListener('change',async()=>{try{state.profileEpoch++;state.profile=state.profiles.find(value=>value.id===$('profiles').value)??null;workflowPage.profileChanged();reviewerPage.profileChanged();grpcPage.profileChanged();state.draft=null;state.call=null;state.customer=null;await loadProfile();renderTools();$('call-detail').hidden=true;$('call-empty').hidden=false;renderCustomer();}catch(error){notice(error.message,true);}});
action($('new-profile'),()=>profileForm('new'));action($('rename-profile'),()=>profileForm('rename'));action($('cancel-profile'),()=>{$('profile-form').hidden=true;});
$('profile-form').addEventListener('submit',event=>{event.preventDefault();busy(event.submitter,saveProfile);});
action($('bind-profile'),bindProfile);action($('export-profile'),()=>download('export/'+encodeURIComponent(requireProfile().id),requireProfile().id+'-operator-profile.json'));
action($('import-profile'),()=>$('profile-file').click());
$('profile-file').addEventListener('change',()=>{const file=$('profile-file').files[0];if(file)busy($('import-profile'),()=>importProfile(file));$('profile-file').value='';});
action($('refresh-host'),refreshHost);action($('native-status'),nativeStatus);
action($('review-host'),async()=>{setPage('host');await loadHostReview();$('host-review-panel').scrollIntoView({block:'start'});});
action($('compare-host'),loadHostReview);
action($('export-host-review'),()=>download(reviewPath(true),requireProfile().id+'-host-review.json'));
action($('adopt-host-snapshot'),adoptReviewedHost);
$('review-binding').addEventListener('change',()=>{state.reviewBaseline=$('review-binding').value;busy($('compare-host'),loadHostReview);});
$('review-filter').addEventListener('submit',event=>{event.preventDefault();state.reviewOffset=0;renderHostReview();});
action($('previous-review'),()=>{state.reviewOffset=Math.max(0,state.reviewOffset-50);renderHostReview();});
action($('next-review'),()=>{state.reviewOffset+=50;renderHostReview();});
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
$('customer-family').addEventListener('change',customerFormRules);
$('customer-form').addEventListener('submit',event=>{event.preventDefault();busy(event.submitter,()=>receiveCustomer({family:$('customer-family').value,...(customerWorkspace($('customer-family').value)?{workspace:$('customer-workspace').value}:{}),exportId:$('customer-export').value,expectedManifestSha256:$('customer-sha').value}));});
customerFormRules();
action($('refresh-customers'),()=>loadProfile());
action($('resume-customer'),()=>receiveCustomer(state.customer.identity));
action($('pause-customer'),async()=>{await api('customer-pause',{method:'POST',body:{id:state.customer.id}});await loadProfile();notice('Pause requested at the original receiving checkpoint.');});
action($('download-customer'),()=>download('customer-archive/'+encodeURIComponent(state.customer.id),
  state.customer.identity.family==='grant-reviewer'?(state.customer.manifest?.kind==='reviewer-packet'?'grant-reviewer-packet.json':state.customer.manifest?.files?.[0]?.name??'original-file'):state.customer.identity.exportId+'.tar.gz',{stream:state.customer.identity.family==='grpc',maximumBytes:(state.customer.files??[]).reduce((sum,file)=>sum+file.bytes,0)+1048576}));
const workflowPage=createWorkflowPage({state,$,node,text,pretty,when,tag,properties,selectionList,action,busy,api,notice,uid,
  requireProfile,loadProfile,openCall,chooseTool,download,schedulePoll,customerCallReady,prepareCustomer});
const reviewerPage=createReviewerCustomerPage({state,$,node,text,pretty,when,properties,action,busy,api,notice,uid,
  requireProfile,loadProfile,openCall,fillCustomer,receiveCustomer,download,setPage,
  useRecipe:(recipe,inputs)=>workflowPage.useRecipe(recipe,inputs)});
const grpcPage=createGrpcCustomerPage({state,$,node,text,pretty,when,properties,action,api,notice,uid,
  requireProfile,loadProfile,openCall,fillCustomer,receiveCustomer,download,setPage,
  useRecipe:(recipe,inputs)=>workflowPage.useRecipe(recipe,inputs)});
const bootstrap=new URLSearchParams(location.hash.slice(1)).get('token');
if(bootstrap){history.replaceState(null,'',location.pathname+location.search);$('access-token').value=bootstrap;busy($('connect-form').querySelector('button'),connect);}
