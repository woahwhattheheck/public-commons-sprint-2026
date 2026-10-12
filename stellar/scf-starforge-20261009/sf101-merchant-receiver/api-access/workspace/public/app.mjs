// MIT. Private API-pass customer workspace; original native writers retain authority.

'use strict';
const $=id=>document.getElementById(id),ACTIVE=new Set(['QUEUED','RUNNING','CANCELLING']);
const S={session:null,key:null,epoch:0,state:null,route:null,detail:null,call:null,sequence:0,drafts:new Map(),running:new Set(),actions:[],timer:null,refreshing:null,panel:null,panelId:null,panelModule:null,remote:new Map()};
const LABELS={'refresh':'Refresh allowance','call':'Send saved request','recover':'Recover original result','prepare-purchase':'Prepare original purchase','review-purchase':'Review original purchase','execute-purchase':'Run reviewed purchase','recover-purchase':'Reopen original purchase','finalize-purchase':'Reconcile purchase','report-purchase':'Export buyer history','inspect-lost-output':'Inspect original lost output','recover-lost-output':'Recover selected payment','read-lost-output':'Authenticate saved recovery','export-lost-output':'Export payment proof'};
const clean=value=>value===null||value===undefined?'—':typeof value==='object'?JSON.stringify(value):String(value);
const fail=(code,status)=>Object.assign(new Error(code),{code,status});
const errorText=error=>({WORKSPACE_AUTHENTICATION_REQUIRED:'The workspace key expired. Reopen the current private startup link.',SESSION_CHANGED:'This action belongs to the previous workspace session. Its exact request is still saved.',WORKSPACE_REVISION_CHANGED:'The workspace changed. Refresh and review this action before rebasing it.',PURCHASE_OPERATION_ACTIVE:'This purchase already has an active original operation.',REQUEST_OPERATION_ACTIVE:'This request already has an active operation.',ORIGINAL_REQUEST_INPUTS_NOT_RETAINED_USE_RECOVER:'Use result recovery for this original merchant request.',ORIGINAL_APPROVAL_CAPABILITY_REQUIRED:'This retained native runtime uses its original terminal approval.',ORIGINAL_BROWSER_APPROVAL_UNAVAILABLE:'This selected native runtime uses its original terminal approval.'}[error?.code]??error?.code??error?.message??'Operation failed');
function node(tag,text,cls){const out=document.createElement(tag);if(text!==undefined&&text!==null)out.textContent=clean(text);if(cls)out.className=cls;return out;}
function append(parent,...children){for(const child of children.flat())if(child!==null&&child!==undefined)parent.append(typeof child==='string'?document.createTextNode(child):child);return parent;}
function button(title,action,{primary=false,disabled=false}={}){const b=node('button',title,primary?'primary':'');b.type='button';b.disabled=disabled;b.addEventListener('click',()=>Promise.resolve().then(action).catch(showError));return b;}
function link(title,href){const a=node('a',title);const url=new URL(href,location.href);if(url.origin!==location.origin)throw fail('LOCAL_LINK_REQUIRED');a.href=url.href;return a;}
function status(value){return node('span',value,'badge'+(/ATTENTION|INTERRUPTED|RECOVERY|FAILED/.test(value??'')?' attention':''));}
function showError(error){const view=$('notice');view.textContent=errorText(error);view.hidden=false;}
function notice(text){$('notice').textContent=text;$('notice').hidden=false;}
function facts(rows){const dl=node('dl',null,'facts');for(const [name,value]of rows)append(dl,node('dt',name),node('dd',value));return dl;}
function panel(title,...content){const section=node('section',null,'panel');if(title)section.append(node('h2',title));append(section,...content);return section;}
function table(headers,rows){const wrap=node('div',null,'table-scroll'),t=node('table'),head=node('thead'),body=node('tbody');append(head,append(node('tr'),headers.map(x=>node('th',x))));for(const row of rows){const tr=node('tr');for(const value of row){const td=node('td');append(td,value);tr.append(td);}body.append(tr);}append(t,head,body);wrap.append(t);return wrap;}
function code(value){return node('code',value);}
const profile=id=>S.state?.profiles.find(row=>row.id===id);
const draft=key=>{if(!S.drafts.has(key))S.drafts.set(key,{});return S.drafts.get(key);};
function currentScope(){if(!S.session||!S.key)throw fail('WORKSPACE_AUTHENTICATION_REQUIRED',401);return {id:S.session.workspaceId,key:S.key,epoch:S.epoch};}
function checkScope(scope){if(!S.session||S.session.workspaceId!==scope.id||S.key!==scope.key||S.epoch!==scope.epoch)throw fail('SESSION_CHANGED');}
async function api(path,{method='GET',body,scope=currentScope(),raw=false}={}){
 checkScope(scope);
 const response=await fetch(path,{method,credentials:'same-origin',redirect:'error',headers:{Authorization:'Bearer '+scope.key,...(body===undefined?{}:{'Content-Type':'application/json'})},...(body===undefined?{}:{body})});
 checkScope(scope);
 if(!response.ok){let value={};try{value=await response.json();}catch{}const error=fail(value.error??'HTTP_'+response.status,response.status);if(response.status===401&&S.epoch===scope.epoch)lock();throw error;}
 return raw?response:response.json();
}
let database;
function db(){return database??=new Promise((resolve,reject)=>{const q=indexedDB.open('sf101-api-pass-actions-v1',1);q.onupgradeneeded=()=>q.result.createObjectStore('actions',{keyPath:'key'});q.onsuccess=()=>resolve(q.result);q.onerror=()=>reject(fail('BROWSER_ACTION_STORAGE_UNAVAILABLE'));});}
async function saved(action){const database=await db();return new Promise((resolve,reject)=>{const tx=database.transaction('actions','readwrite');tx.objectStore('actions').put(action);tx.oncomplete=()=>resolve(action);tx.onerror=tx.onabort=()=>reject(fail('BROWSER_ACTION_SAVE_FAILED'));});}
async function actions(){const database=await db();return new Promise((resolve,reject)=>{const q=database.transaction('actions').objectStore('actions').getAll();q.onsuccess=()=>resolve(q.result.filter(a=>a.workspaceId===S.session?.workspaceId).sort((a,b)=>b.createdAt.localeCompare(a.createdAt)));q.onerror=()=>reject(fail('BROWSER_ACTION_STORAGE_UNAVAILABLE'));});}
async function refreshActions(){const scope=currentScope(),rows=await actions();checkScope(scope);S.actions=rows;return rows;}
async function sendAction(action){
 const scope=currentScope();if(scope.id!==action.workspaceId)throw fail('SESSION_CHANGED');
 if(S.running.has(action.key))return;S.running.add(action.key);
 try{
  action.status='SENDING';action.error=null;await saved(action);checkScope(scope);
  const value=await api(action.path,{method:'POST',body:action.body,scope});
  action.status='COMPLETED';action.result=value.result;action.completedAt=new Date().toISOString();await saved(action);checkScope(scope);
  S.state=value.state;await refreshActions();renderShell();
  if(action.navigate!==false){if(value.result?.callId)location.hash='call/'+value.result.callId;else if(value.result?.profileId)location.hash='pass/'+value.result.profileId;}
  if(S.route?.kind==='actions')await renderRoute();else await refreshCurrent({force:true});
  return value;
 }catch(error){
  action.status=error.status&&error.status<500&&error.status!==401?'REJECTED':'ATTENTION';action.error=errorText(error);
  try{await saved(action);}catch{}
  if(action.result!==null){action.status='COMPLETED';action.error=null;try{await saved(action);}catch{}}
  if(S.session?.workspaceId===action.workspaceId){await refreshActions().catch(()=>{});if(S.route?.kind==='actions')renderActions();}
  throw error;
 }finally{S.running.delete(action.key);schedule();}
}
async function act(path,input,title,{navigate=true}={}){
 const scope=currentScope(),id=crypto.randomUUID();const action={key:scope.id+':'+id,workspaceId:scope.id,id,path,title,navigate,createdAt:new Date().toISOString(),status:'SAVED',error:null,result:null,body:JSON.stringify({...input,operationId:id,expectedRevision:S.state.revision})};
 await saved(action);checkScope(scope);return sendAction(action);
}
async function queue(id,kind,extra={}){return act('/api/profiles/'+id+'/tasks',{kind,...extra},LABELS[kind]??kind,{navigate:false});}
function busy(id,callId){return S.state?.tasks.some(t=>ACTIVE.has(t.status)&&(callId?t.callId===callId:t.profileId===id))??false;}
async function download(path,name,sha256){
 const scope=currentScope(),r=await api(path,{raw:true,scope}),bytes=await r.arrayBuffer();checkScope(scope);
 const expected=sha256??r.headers.get('X-SF101-Result-Sha256');
 if(expected){const actual=[...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(v=>v.toString(16).padStart(2,'0')).join('');checkScope(scope);if(actual!==expected)throw fail('DOWNLOADED_FILE_HASH_CHANGED');}
 const url=URL.createObjectURL(new Blob([bytes],{type:r.headers.get('content-type')??'application/octet-stream'})),a=node('a');a.href=url;a.download=name;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);
}
function showDocument(title,value){$('document-title').textContent=title;$('document-body').textContent=typeof value==='string'?value:JSON.stringify(value,null,2);$('document-dialog').showModal();}
async function inspectFile(path,title){const value=await api(path);showDocument(title,value);}
function formField(form,key,labelText,{type='text',value='',help,required=false,full=false,choices,rows=5}={}){
 const box=node('div',null,'field'+(full?' full':'')),id='f-'+crypto.randomUUID();const label=node('label',labelText);label.htmlFor=id;let input;
 if(type==='textarea'){input=node('textarea');input.rows=rows;}else if(type==='select'){input=node('select');for(const choice of choices??[]){const [v,t]=Array.isArray(choice)?choice:[choice,choice],o=node('option',t);o.value=v;input.append(o);}}else{input=node('input');input.type=type;}
 input.id=id;input.name=key;input.required=required;if(type!=='file'){input.value=value??'';input.addEventListener('input',()=>form.data[key]=input.value);}
 append(box,label,input,help?node('small',help):null);form.grid.append(box);return input;
}
function form(key,onSubmit){const out=node('form');out.data=draft(key);out.grid=node('div',null,'form-grid');out.append(out.grid);out.addEventListener('submit',event=>{event.preventDefault();Promise.resolve().then(()=>onSubmit(out)).catch(showError);});return out;}
function submit(form,labelText,help){const group=node('div',null,'form-actions'),b=node('button',labelText,'primary');b.type='submit';append(group,b,help?node('small',help):null);form.append(group);return b;}
function textFile(form,key,input,labelText,max){
 input.addEventListener('change',()=>{const file=input.files?.[0],scope=currentScope();if(!file)return;if(file.size>max){showError(fail('INPUT_FILE_TOO_LARGE'));return;}
 file.text().then(value=>{checkScope(scope);form.data[key]=value;const target=form.elements.namedItem(key);if(target)target.value=value;notice(labelText+' loaded: '+file.name);}).catch(showError);});
}
function header(title,description,...controls){const h=node('div',null,'page-head'),left=node('div');append(left,node('h1',title),description?node('p',description):null);append(h,left,append(node('div',null,'actions'),controls));return h;}
function renderShell(){
 if(!S.state)return;$('workspace-title').textContent=S.state.title;$('revision').textContent='Revision '+S.state.revision+' · '+S.state.id;
 $('pass-list').replaceChildren(...S.state.profiles.filter(p=>!p.archived).map(p=>{const a=link(p.label,'#pass/'+p.id);if(S.route?.id===p.id)a.setAttribute('aria-current','page');return a;}));
 for(const a of document.querySelectorAll('aside nav a')){const selected=a.hash===location.hash||!location.hash&&a.hash==='#home';if(selected)a.setAttribute('aria-current','page');else a.removeAttribute('aria-current');}
}
function routes(){const parts=location.hash.replace(/^#/,'').split('/');if(parts[0]==='pass'&&parts[1])return {kind:'pass',id:parts[1],tab:parts[2]??'overview'};if(parts[0]==='call'&&parts[1])return {kind:'call',id:parts[1]};return {kind:['connect','purchase','attach','actions'].includes(parts[0])?parts[0]:'home'};}
function disposeApproval(){S.panel?.dispose();S.panel=null;S.panelId=null;}
async function renderRoute(){
 if(!S.session)return;const seq=++S.sequence;S.route=routes();disposeApproval();$('view').replaceChildren();renderShell();
 if(S.route.kind==='home')return renderHome();
 if(S.route.kind==='actions'){await refreshActions();if(seq===S.sequence)renderActions();return;}
 if(['connect','purchase','attach'].includes(S.route.kind))return renderAdd(S.route.kind);
 const scope=currentScope();
 if(S.route.kind==='call'){const value=await api('/api/calls/'+S.route.id,{scope});if(seq!==S.sequence)return;S.call=value.call;renderCall(value.call);return;}
 const value=await api('/api/profiles/'+S.route.id,{scope});if(seq!==S.sequence)return;S.detail=value;renderPass(value);
}
function renderHome(){
 const view=$('view');append(view,header('API passes','Purchased allowances, original requests and retained results in one workspace.',button('Connect a pass',()=>{location.hash='connect';},{primary:true})));
 const grid=node('div',null,'card-grid');for(const p of S.state.profiles){const card=link('','#pass/'+p.id);card.className='pass-card';append(card,node('h2',p.label),node('p',p.orderReference,'mono'),status(p.archived?'ARCHIVED':p.detail?.native?.state??(p.mode==='purchase'?'PURCHASE':'CONNECTED')),facts([['Gateway',p.gatewayBaseUrl],['Available',p.detail?.usage?.availableUnits??p.detail?.usage?.available],['Requests',p.callCount],['Last refreshed',p.checkedAt]]));grid.append(card);}
 view.append(grid);if(!S.state.profiles.length)view.append(panel(null,node('p','Connect an existing purchased pass or open its original saved purchase.','empty')));
}
function renderAdd(kind){
 const info={connect:['Connect a pass','Use the original order, purchased plan hash and the host’s claim environment name.'],purchase:['New original purchase','Load the merchant’s full checkout handoff. Preparation, review and payment use the original Buyer and Inbox.'],attach:['Open saved purchase','Reopen the original ApiAccessPurchase directory with the configured Buyer workspace.']}[kind];
 const f=form('add:'+kind,async f=>{
  const d={...f.data};for(const input of f.elements)if(input.name&&input.type!=='file')d[input.name]=input.value;
  const path=kind==='connect'?'/api/passes/connect':kind==='purchase'?'/api/purchases/prepare':'/api/purchases/attach';
  const value=kind==='attach'?{label:d.label,purchaseDirectory:d.purchaseDirectory}:kind==='connect'?{label:d.label,gatewayBaseUrl:d.gatewayBaseUrl,orderReference:d.orderReference,manifestSha256:d.manifestSha256,claimEnv:d.claimEnv}:{label:d.label,gatewayBaseUrl:d.gatewayBaseUrl,intentId:d.intentId,claimEnv:d.claimEnv,handoff:d.handoff};
  await act(path,value,info[0]);});
 const d=f.data;formField(f,'label','Pass name',{value:d.label,required:true});
 if(kind==='attach')formField(f,'purchaseDirectory','Original purchase directory',{value:d.purchaseDirectory,required:true,help:'Absolute host path containing the original customer.json and handoff.json.'});
 else{
  formField(f,'gatewayBaseUrl','API gateway origin',{value:d.gatewayBaseUrl,required:true,help:'HTTPS origin or the explicit local gateway, for example http://127.0.0.1:43112.'});
  formField(f,'claimEnv','Host claim environment',{type:'select',value:d.claimEnv??S.state.claimEnvs[0],choices:S.state.claimEnvs,help:'The token value remains on the host.'});
  if(kind==='connect'){formField(f,'orderReference','Original order reference',{value:d.orderReference,required:true});formField(f,'manifestSha256','Purchased plan SHA-256',{value:d.manifestSha256,required:true,full:true});}
  else{
   formField(f,'intentId','Stable original purchase intent',{value:d.intentId??('api-pass-'+crypto.randomUUID()),required:true});
   const area=formField(f,'handoff','Full original checkout handoff JSON',{type:'textarea',value:d.handoff,required:true,full:true,rows:9});
   const file=formField(f,'handoffFile','Load handoff file',{type:'file',full:true});textFile(f,'handoff',file,'Original handoff',65536);
  }
 }
 const b=submit(f,kind==='purchase'?'Save purchase preparation':info[0]);if(kind!=='connect'&&!S.state.purchaseEnabled)b.disabled=true;
 append($('view'),header(...info),panel(null,f));
 if(kind!=='connect'&&!S.state.purchaseEnabled)$('view').append(panel('Original Buyer setup',node('p','Configure this customer workspace with the original --buyer-workspace before preparing or adopting a purchase.')));
}
function passTabs(p){const nav=node('nav',null,'tabs');for(const [id,label]of [['overview','Overview'],['compose','New request'],['history','Saved requests'],['merchant','Merchant history']]){const a=link(label,'#pass/'+p.id+'/'+id);if((S.route.tab??'overview')===id)a.setAttribute('aria-current','page');nav.append(a);}return nav;}
function renderPass(detail){
 const p=detail.profile,view=$('view');append(view,header(p.label,p.orderReference,button('Refresh allowance',()=>queue(p.id,'refresh'),{disabled:busy(p.id)}),button('Export customer history',()=>download('/api/profiles/'+p.id+'/export','api-pass-customer-history.json'))),passTabs(p));
 const live=node('div');live.id='pass-live';view.append(live);renderPassLive(p);
 if(S.route.tab==='compose')renderComposer(p);
 else if(S.route.tab==='history')renderHistory(detail);
 else if(S.route.tab==='merchant')void renderMerchant(p.id).catch(showError);
 else renderOverview(p,detail);
 const taskHost=node('div');taskHost.id='task-list';view.append(taskHost);renderTasks(detail.tasks);
}
function renderPassLive(p){
 const host=$('pass-live');if(!host)return;host.replaceChildren();
 const u=p.detail?.usage;const data=[['Purchased',u?.allowanceUnits??u?.allowance],['Consumed',u?.consumedUnits??u?.consumed],['Reserved',u?.reservedUnits??u?.reserved],['Available',u?.availableUnits??u?.available]];
 const metrics=node('div',null,'metrics');for(const [label,value]of data)metrics.append(append(node('div',null,'metric'),node('strong',value),node('span',label)));host.append(metrics);
 if(p.error)host.append(node('p',p.error.code,'error'));if(p.archived)host.append(node('p','This pass is archived. Restore it below to dispatch requests.','error'));
}
function renderOverview(p,detail){
 const view=$('view');view.append(panel('Purchased access',facts([['Gateway',p.gatewayBaseUrl],['Plan SHA-256',p.manifestSha256],['Claim environment',p.claimEnv+(p.claimAvailable?' · available':' · unavailable')],['Order state',p.detail?.native?.state],['Access controls',p.detail?.native?.access],['Last refreshed',p.checkedAt],['Manifest',p.detail?.manifest]])));
 const routes=p.detail?.plan?.routes??[];view.append(panel('Purchased routes',routes.length?table(['Route','Method','Path','Units'],routes.map(r=>[r.id,r.method,code(r.path),r.units])):node('p','Refresh the pass to read its original purchased routes.','muted')));
 const f=form('edit:'+p.id,async f=>act('/api/profiles/'+p.id+'/update',{label:f.elements.namedItem('label').value,archived:f.elements.namedItem('archived').value==='yes'},'Update pass',{navigate:false}));
 formField(f,'label','Pass name',{value:f.data.label??p.label,required:true});formField(f,'archived','Workspace availability',{type:'select',value:f.data.archived??(p.archived?'yes':'no'),choices:[['no','Active'],['yes','Archived']]});submit(f,'Save pass');view.append(panel('Workspace settings',f));
 if(p.mode==='purchase')renderPurchase(p);
}
function renderComposer(p){
 const key='compose:'+p.id,d=draft(key),routes=p.detail?.plan?.routes??[];
 if(!routes.length){$('view').append(panel('Request',node('p','Refresh this pass before choosing a purchased route.')));return;}
 d.query??=[['','']];d.requestId??='request-'+crypto.randomUUID();d.bodyMode??='none';
 const f=form(key,async form=>{
  const selected=currentScope(),state={...form.data},id=p.id,query=state.query.filter(row=>row[0]!==''||row[1]!=='');
  const input={requestId:form.elements.namedItem('requestId').value,label:form.elements.namedItem('label').value,routeId:form.elements.namedItem('routeId').value,query,contentType:form.elements.namedItem('contentType').value,bodyBase64:null};
  const mode=form.elements.namedItem('bodyMode').value;
  if(mode==='text')input.bodyBase64=base64(new TextEncoder().encode(form.elements.namedItem('bodyText').value));
  if(mode==='file'){if(typeof state.fileBase64!=='string')throw fail('SELECT_REQUEST_BODY_FILE');input.bodyBase64=state.fileBase64;}
  checkScope(selected);await act('/api/profiles/'+id+'/calls',input,'Save exact request');
 });
 formField(f,'routeId','Purchased route',{type:'select',value:d.routeId??routes[0].id,choices:routes.map(r=>[r.id,r.method+' '+r.path+' · '+r.units+' unit(s)']),required:true});
 formField(f,'requestId','Stable request ID',{value:d.requestId,required:true,help:'Keep this identity when retrieving or replaying this operation.'});
 formField(f,'label','Request label',{value:d.label??d.requestId,required:true});
 formField(f,'contentType','Request content type',{value:d.contentType??'application/json',required:true});
 const query=node('div',null,'field full');query.append(node('label','Query parameters'));
 const rows=node('div');query.append(rows);
 const paint=()=>{rows.replaceChildren();d.query.forEach((pair,index)=>{const row=node('div',null,'query-row'),k=node('input'),v=node('input');k.placeholder='Parameter';v.placeholder='Value';k.value=pair[0];v.value=pair[1];k.setAttribute('aria-label','Query parameter '+(index+1));v.setAttribute('aria-label','Query value '+(index+1));k.addEventListener('input',()=>pair[0]=k.value);v.addEventListener('input',()=>pair[1]=v.value);append(row,k,v,button('Remove',()=>{d.query.splice(index,1);paint();}));rows.append(row);});};paint();query.append(button('Add parameter',()=>{d.query.push(['','']);paint();}));f.grid.append(query);
 formField(f,'bodyMode','Request body',{type:'select',value:d.bodyMode,choices:[['none','No body'],['text','Text / JSON'],['file','Exact file bytes']]});
 formField(f,'bodyText','Text / JSON body',{type:'textarea',value:d.bodyText,full:true,rows:9,help:'Saved as UTF-8. JSON is preserved as entered.'});
 const file=formField(f,'bodyFile','Body file',{type:'file',full:true,help:d.filename?'Selected: '+d.filename:'Maximum 1 MiB. Select “Exact file bytes” above.'});
 file.addEventListener('change',()=>{const chosen=file.files?.[0],scope=currentScope();if(!chosen)return;if(chosen.size>1048576){showError(fail('REQUEST_TOO_LARGE'));return;}chosen.arrayBuffer().then(raw=>{checkScope(scope);d.fileBase64=base64(new Uint8Array(raw));d.filename=chosen.name;d.bodyMode='file';f.elements.namedItem('bodyMode').value='file';notice('Body retained in this form: '+chosen.name+' · '+raw.byteLength+' bytes');}).catch(showError);});
 submit(f,'Save exact request','The saved request is dispatched from its own result page.');$('view').append(panel('Prepare a request',f));
}
function base64(bytes){let s='';for(let i=0;i<bytes.length;i+=32768)s+=String.fromCharCode(...bytes.subarray(i,i+32768));return btoa(s);}
function renderHistory(detail){
 const p=detail.profile,rows=detail.calls.map(c=>[link(c.label,'#call/'+c.id),code(c.requestId),c.method+' '+c.path,c.units,status(c.status),c.result?c.result.bytes+' B':'—']);
 $('view').append(panel('Saved requests',rows.length?table(['Request','Original ID','Route','Units','State','Result'],rows):node('p','Prepare a new request or adopt one from merchant history.','empty')));
 const next=detail.callPagination.nextOffset;if(next!==null)$('view').append(button('Next saved request page',async()=>{const value=await api('/api/profiles/'+p.id+'?offset='+next);S.detail=value;$('view').replaceChildren();renderPass(value);}));
}
async function renderMerchant(id,after){
 const scope=currentScope(),seq=S.sequence,path='/api/profiles/'+id+'/remote-calls?limit=100'+(after?'&after='+encodeURIComponent(after):'');
 const page=await api(path,{scope});if(seq!==S.sequence||S.route?.id!==id||S.route.tab!=='merchant')return;S.remote.set(id,page);
 let host=$('merchant-history');if(!host){host=node('section',null,'panel');host.id='merchant-history';$('task-list')?$('view').insertBefore(host,$('task-list')):$('view').append(host);}host.replaceChildren(node('h2','Original merchant call history'));
 if(!page.calls.length){host.append(node('p','No original calls on this page.','empty'));return;}
 host.append(table(['Original request','Route','Units','State','Result',''],page.calls.map(c=>[code(c.requestId),c.method+' '+c.path,c.units,status(c.status),c.result?c.result.bytes+' B':'—',button('Open recovery',()=>act('/api/profiles/'+id+'/adopt-request',{requestId:c.requestId},'Adopt original request'))])));
 if(page.nextAfter)host.append(button('Next merchant page',()=>renderMerchant(id,page.nextAfter)));host.append(button('First merchant page',()=>renderMerchant(id)));
}
function renderCall(c){
 const p=profile(c.profileId),view=$('view');append(view,header(c.label,c.requestId,link('Back to pass','#pass/'+c.profileId+'/history')),panel('Original request',facts([['Pass',p?.label],['Method / path',c.method+' '+c.path],['Route / units',c.routeId+' · '+c.units],['State',c.status],['Content type',c.contentType],['Query parameters',c.query],['Body',c.body?c.body.bytes+' bytes / '+c.body.sha256:'Absent'],['Request fingerprint',c.fingerprint],['Created',c.createdAt]])));
 const controls=node('div',null,'actions');if(!c.recoveryOnly)controls.append(button(c.result?'Replay same saved request':'Send saved request',()=>queue(c.profileId,'call',{callId:c.id}),{primary:!c.result,disabled:busy(c.profileId,c.id)||p?.archived}));
 controls.append(button('Recover original result',()=>queue(c.profileId,'recover',{callId:c.id}),{disabled:busy(c.profileId,c.id)||p?.archived}),button('Inspect saved body',()=>inspectFile('/api/calls/'+c.id+'/body','Saved request body')));
 view.append(controls);if(c.error)view.append(node('p',c.error.code,'error'));
 if(c.result){
  view.append(panel('Retained response',facts([['HTTP status',c.result.status],['Bytes',c.result.bytes],['SHA-256',c.result.sha256],['Same-ID replay',c.result.replayed],['Retained at',c.updatedAt]]),
   append(node('div',null,'actions'),button('Download exact response',()=>download(c.result.downloadUrl,c.routeId+'-'+c.requestId+'.bin',c.result.sha256),{primary:true}),button('Preview response',async()=>{const data=await api(c.result.previewUrl);showDocument('Retained response',data.binary?'Binary response; use the exact download.':data.text+(data.truncated?'\n\n[Preview truncated]':''));}))));
 }
 if(c.history?.length)view.append(panel('Request history',table(['Time','Action','Result'],c.history.slice().reverse().map(h=>[h.at,LABELS[h.action]??h.action,h.error?.code??('HTTP '+h.status+' · '+h.sha256)]))));
 const host=node('div');host.id='task-list';view.append(host);renderTasks(S.state.tasks.filter(t=>t.callId===c.id));
}
function renderTasks(tasks){
 const host=$('task-list');if(!host)return;host.replaceChildren();const rows=tasks.map(t=>{
  const controls=node('div',null,'actions');
  if(ACTIVE.has(t.status))controls.append(button('Stop',()=>act('/api/tasks/'+t.id+'/cancel',{},'Stop original operation',{navigate:false})));
  if(t.result?.report)controls.append(button('Buyer history',()=>download(t.result.report.downloadUrl,'api-pass-buyer-history.html',t.result.report.sha256)));
  if(t.result?.proof)controls.append(button('Payment proof',()=>download(t.result.proof.downloadUrl,'api-pass-original-payment-proof.json',t.result.proof.sha256)));
  controls.append(button('Details',()=>showDocument(LABELS[t.kind]??t.kind,t)));
  return [LABELS[t.kind]??t.kind,status(t.status),t.createdAt,t.error?.code??(t.result?.status?'HTTP '+t.result.status:'—'),controls];
 });
 host.append(panel('Original operations',rows.length?table(['Operation','State','Started','Result',''],rows):node('p','Operations will appear here after dispatch.','muted')));
}
function renderPurchase(p){
 const nativeBusy=()=>p.activeTasks.some(t=>t.kind!=='refresh'&&ACTIVE.has(t.status));
 const controls=node('div',null,'actions');
 for(const kind of ['prepare-purchase','review-purchase','execute-purchase','recover-purchase','finalize-purchase','report-purchase'])
  controls.append(button(LABELS[kind],()=>queue(p.id,kind,kind==='execute-purchase'?{reviewId:profile(p.id).review?.id}:{}),{disabled:nativeBusy()||p.archived||kind==='execute-purchase'&&!p.review}));
 const info=panel('Original purchase',facts([['Intent',p.intentId],['Original state',p.native?.state],['Payment terms',p.handoff?.payment],['Purchase URL',p.handoff?.purchaseUrl],['Native outcome',p.native?.outcome],['Local preparation',p.purchasePrepared?'Retained':'Waiting for preparation']]),controls);
 if(p.review)info.append(node('hr',null,'divider'),facts([['Saved review',p.review.id],['Review SHA-256',p.review.sha256],['Reviewed at',p.review.reviewedAt]]),button('Download original review',()=>download(p.review.downloadUrl,'api-pass-original-review.json',p.review.sha256)));
 $('view').append(info);
 const approval=panel('Payment approval',node('p',S.state.approvalMode==='ORIGINAL_BROWSER_BROKER'?'The original operator presents the exact native request here when it needs a decision.':'The selected original runtime uses its controlling terminal for payment approval.','muted'));
 const host=node('div');host.id='approval-host';approval.append(host);$('view').append(approval);
 if(S.state.approvalMode==='ORIGINAL_BROWSER_BROKER')void refreshApproval(p.id).catch(showError);
 renderRecovery(p);
}
async function refreshApproval(id){
 const scope=currentScope(),seq=S.sequence;
 if(!S.session||S.route?.id!==id||S.route.tab!=='overview')return;
 try{
  S.panelModule??=await import('/original-approval/approval-panel.mjs');checkScope(scope);if(seq!==S.sequence)return;
  if(S.panelId!==id){
   disposeApproval();S.panelId=id;S.panel=S.panelModule.createApprovalPanel({host:$('approval-host'),
    decide:value=>{checkScope(scope);if(S.panelId!==id)throw fail('SESSION_CHANGED');return act('/api/profiles/'+id+'/approval',value,'Record original payment decision',{navigate:false});},
    refresh:()=>refreshApproval(id)});
   if(!document.getElementById('approval-style')){const css=node('link');css.id='approval-style';css.rel='stylesheet';css.href='/original-approval/approval.css';document.head.append(css);}
  }
  S.panel.disconnect();
  const value=await api('/api/profiles/'+id+'/approval',{scope});if(seq===S.sequence&&S.panelId===id)S.panel.render(value.approval,{intentId:value.intentId,pending:value.pending===true,fresh:true});
 }catch(error){if(S.panelId===id)S.panel?.disconnect();throw error;}
}
function renderRecovery(p){
 const section=panel('Recover a paid attempt with lost local output',node('p','Reopen the existing original reservation and its selected transaction. The exact approved request is retained before inspection.','muted'));
 append(section,append(node('div',null,'actions'),button('Authenticate saved recovery',()=>queue(p.id,'read-lost-output'),{disabled:busy(p.id)}),button('Export payment proof',()=>queue(p.id,'export-lost-output'),{disabled:busy(p.id)})));
 if(p.native?.lostOutput)section.append(facts([['Recorded authority',p.native.lostOutput.recordAuthority],['Transaction',p.native.lostOutput.transaction],['Original attempt',p.native.lostOutput.attemptId],['Observed / completed',p.native.lostOutput.observedAt+' / '+p.native.lostOutput.completedAt],['Verified transfer',p.native.lostOutput.verifiedFacts],['Local output condition',p.native.lostOutput.evidenceState]]));
 const f=form('loss:'+p.id,async f=>queue(p.id,'inspect-lost-output',{approvedRequestText:f.elements.namedItem('approvedRequestText').value}));
 formField(f,'approvedRequestText','Complete original approved-request JSON',{type:'textarea',value:f.data.approvedRequestText,required:true,full:true,rows:7});
 const file=formField(f,'approvedFile','Load original approved request',{type:'file',full:true});textFile(f,'approvedRequestText',file,'Original approved request',32768);submit(f,'Inspect original paid attempt');section.append(node('hr',null,'divider'),f);
 if(p.lostOutputAttempt){
  section.append(node('hr',null,'divider'),node('h3','Retained original inspection'),facts([['Review',p.lostOutputAttempt.id],['Original request SHA-256',p.lostOutputAttempt.snapshot.expectedRequestSha256],['Attempt',p.lostOutputAttempt.snapshot.attemptId],['Original attempt time',p.lostOutputAttempt.snapshot.attemptStartedAt]]),button('Inspect complete native selection',()=>showDocument('Original lost-output inspection',p.lostOutputAttempt.snapshot)));
  const r=form('tx:'+p.id,async f=>queue(p.id,'recover-lost-output',{reviewId:profile(p.id).lostOutputAttempt.id,transaction:f.elements.namedItem('transaction').value}));
  formField(r,'transaction','Exact original transaction hash',{value:r.data.transaction,required:true,full:true,help:'This selection is bound to the retained request, attempt and configuration above.'});submit(r,'Recover selected original payment');section.append(r);
 }
 $('view').append(section);
}
function renderActions(){
 const rows=S.actions.map(a=>{
  const controls=node('div',null,'actions');controls.append(button('Exact request',()=>showDocument(a.title,JSON.parse(a.body))));
  if(a.status!=='COMPLETED')controls.append(button(S.running.has(a.key)?'Sending…':'Retry same saved action',()=>sendAction(a),{disabled:S.running.has(a.key)}));
  if(a.status==='REJECTED'&&a.error?.includes('workspace changed'))controls.append(button('Rebase after review',async()=>{
   const old=JSON.parse(a.body),value={...old,expectedRevision:S.state.revision};a.revisions??=[];a.revisions.push({at:new Date().toISOString(),body:a.body});a.body=JSON.stringify(value);a.status='SAVED';await saved(a);await sendAction(a);
  }));
  return [a.title,status(a.status),a.createdAt,a.error??a.result?.taskId??a.result?.callId??'—',controls];
 });
 $('view').replaceChildren(header('Saved browser actions','Each mutation is saved locally with its exact JSON and operation ID before dispatch. Interrupted actions resume against their original workspace.'),panel(null,rows.length?table(['Action','State','Created','Result',''],rows):node('p','No saved actions for this workspace.','empty')));
}
async function refreshCurrent({force=false}={}){
 if(!S.session)return;
 if(S.route?.kind==='pass'){
  const scope=currentScope(),seq=S.sequence,value=await api('/api/profiles/'+S.route.id,{scope});if(seq!==S.sequence)return;
  const changed=JSON.stringify([S.detail?.profile?.review,S.detail?.profile?.native,S.detail?.profile?.lostOutputAttempt,S.detail?.profile?.activeTasks])!==JSON.stringify([value.profile.review,value.profile.native,value.profile.lostOutputAttempt,value.profile.activeTasks]);
  S.detail=value;if(S.route.tab==='overview'&&(force||changed)){disposeApproval();$('view').replaceChildren();renderPass(value);return;}
  // Preserve editable form controls during an active operation. Status/history
  // updates still use the original latest state; the explicit Refresh rebuilds.
  renderPassLive(value.profile);renderTasks(value.tasks);
  if(S.route.tab==='overview'&&S.state.approvalMode==='ORIGINAL_BROWSER_BROKER')await refreshApproval(value.profile.id);
 }else if(S.route?.kind==='call'){const scope=currentScope(),seq=S.sequence,value=await api('/api/calls/'+S.route.id,{scope});if(seq!==S.sequence)return;S.call=value.call;$('view').replaceChildren();renderCall(value.call);}
 else if(S.route?.kind==='home'){$('view').replaceChildren();renderHome();}
}
async function refresh({rebuild=false}={}){
 if(!S.session)return;if(S.refreshing)return S.refreshing;
 const scope=currentScope();const operation=(async()=>{const value=await api('/api/state',{scope});checkScope(scope);S.state=value;$('connection').textContent='Connected';renderShell();await refreshActions();if(rebuild)await renderRoute();else await refreshCurrent();})();
 S.refreshing=operation;
 try{await operation;}catch(error){if(S.epoch===scope.epoch){$('connection').textContent='Read interrupted';showError(error);S.panel?.disconnect();}}finally{if(S.refreshing===operation)S.refreshing=null;schedule();}
}
function schedule(){clearTimeout(S.timer);if(S.session&&!document.hidden&&S.state?.tasks.some(t=>ACTIVE.has(t.status)))S.timer=setTimeout(()=>void refresh(),1500);}
function lock(){
 S.epoch++;S.key=null;S.session=null;S.state=null;S.detail=null;S.call=null;S.sequence++;S.refreshing=null;S.actions=[];clearTimeout(S.timer);disposeApproval();sessionStorage.removeItem('sf101-api-pass-key');
 $('workspace').hidden=true;$('login').hidden=false;$('access-key').value='';
}
async function login(key){
 if(!/^[A-Za-z0-9_-]{43}$/.test(key))throw fail('WORKSPACE_ACCESS_KEY_REQUIRED');
 const epoch=++S.epoch;S.key=key;S.session={workspaceId:'connecting'};const response=await fetch('/api/session',{redirect:'error',headers:{Authorization:'Bearer '+key}});
 if(epoch!==S.epoch)return;let value;try{value=await response.json();}catch{throw fail('WORKSPACE_SESSION_INVALID');}
 if(!response.ok){lock();throw fail(value.error??'WORKSPACE_AUTHENTICATION_REQUIRED');}
 if(value.schema!=='stellar-forge.sf101.api-pass-workspace-session.v1'||typeof value.workspaceId!=='string')throw fail('WORKSPACE_SESSION_INVALID');
 S.session=value;sessionStorage.setItem('sf101-api-pass-key',key);S.state=await api('/api/state');await refreshActions();
 for(const a of S.actions.filter(a=>a.status==='SENDING')){a.status='ATTENTION';a.error='The previous response was interrupted. Retry the same saved action.';await saved(a);}
 $('login').hidden=true;$('workspace').hidden=false;$('login-error').textContent='';renderShell();await renderRoute();schedule();
}
$('login-form').addEventListener('submit',event=>{event.preventDefault();login($('access-key').value.trim()).catch(error=>{lock();$('login-error').textContent=errorText(error);});});
$('lock').addEventListener('click',lock);$('refresh').addEventListener('click',()=>void refresh({rebuild:true}));
$('document-close').addEventListener('click',()=>$('document-dialog').close());
window.addEventListener('hashchange',()=>{if(S.session)void renderRoute().catch(showError);});
document.addEventListener('visibilitychange',()=>{if(document.hidden)clearTimeout(S.timer);else if(S.session)void refresh();});
window.addEventListener('online',()=>{if(S.session)void refresh();});
let key=sessionStorage.getItem('sf101-api-pass-key');const fragment=location.hash.slice(1);
if(/^[A-Za-z0-9_-]{43}$/.test(fragment)){key=fragment;history.replaceState(null,'',location.pathname+location.search);}
if(key)try{await login(key);}catch(error){lock();$('login-error').textContent=errorText(error);}

