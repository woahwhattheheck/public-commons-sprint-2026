const $=id=>document.getElementById(id);
const countLabel=(n,label)=>n+' '+label+(n===1?'':'s');
const token=location.hash.slice(1);
let specText='', inspection=null, routeFields=[], selectedPackage=null, busy=false;
const notice=(message,error=false)=>{$('notice').textContent=message;$('notice').classList.toggle('error',error);};
const make=(tag,text,cls)=>{const e=document.createElement(tag);if(text!==undefined)e.textContent=text;if(cls)e.className=cls;return e;};
async function api(path,body) {
  const response=await fetch('/api/'+path,{method:body===undefined?'GET':'POST',headers:{'x-workspace-token':token,...(body===undefined?{}:{'content-type':'application/json'})},...(body===undefined?{}:{body:JSON.stringify(body)})});
  const value=await response.json();
  if(!response.ok)throw new Error(value.error??'Workspace request failed');
  return value;
}
function available() {
  $('preview').disabled=busy||!specText;
  $('save').disabled=busy||!specText;
  $('start-preview').disabled=busy||!selectedPackage;
  $('start-native').disabled=busy||!selectedPackage||!$('facilitator').value.trim();
}
function dirty() {
  selectedPackage=null;
  $('run-label').textContent='Save this configuration as a new package before starting it.';
  $('saved-path').hidden=true;
  $('review').replaceChildren();
  available();
}
async function act(work) {
  if(busy)return;
  const controls=[...document.querySelectorAll('input,select,textarea,button')];
  const prior=controls.map(control=>[control,control.disabled]);
  busy=true;controls.forEach(control=>{control.disabled=true;});available();
  try {await work();}catch(e){notice(e.message,true);}
  finally {
    for(const [control,disabled] of prior)if(control.isConnected)control.disabled=disabled;
    busy=false;available();
    try{runtime(await api('status'));}catch{}
  }
}
function field(label,value,type='text') {
  const container=make('label',label),input=make('input');input.type=type;input.value=value??'';container.append(input);return {container,input};
}
function selectField(label,values,value) {
  const container=make('label',label),input=make('select');
  for(const [key,text] of values){const o=make('option',text);o.value=String(key);input.append(o);}
  input.value=String(value??values[0]?.[0]??'');container.append(input);return {container,input};
}
function drawRoutes(saved=[]) {
  const map=new Map(saved.map(v=>[v.method.toUpperCase()+' '+v.path,v]));
  $('routes').replaceChildren();routeFields=[];
  for(const op of inspection.operations) {
    const previous=map.get(op.method+' '+op.path),card=make('article',undefined,'route'+(op.supported?'':' unavailable'));
    const head=make('div',undefined,'route-head'),label=make('label',undefined,'route-name'),check=make('input');
    check.type='checkbox';check.checked=Boolean(previous);check.disabled=!op.supported;check.setAttribute('aria-label','Select '+(op.method??'unsupported')+' '+op.path);
    label.append(check,make('span',op.method??'REF'),make('strong',op.path));head.append(label);card.append(head);
    if(op.summary)card.append(make('p',op.summary,'route-summary'));
    if(op.error)card.append(make('p',op.error,'hint'));
    if(op.supported) {
      const settings=make('div',undefined,'route-settings');
      const server=selectField('Backend server',op.servers.map(s=>[s.index,s.url+(s.variables?' (expand variables first)':'')]),previous?.serverIndex??0);
      const amount=field('Price in atomic units',previous?.amountAtomic??'');amount.input.inputMode='numeric';amount.input.placeholder='e.g. 20000';
      settings.append(server.container,amount.container);
      const advanced=make('details'),summary=make('summary','Backend credentials and response settings'),fields=make('div',undefined,'fields');
      const headers=make('label','Header → environment variable references'),headerInput=make('textarea');
      headerInput.value=JSON.stringify(previous?.headerEnv??{},null,2);headerInput.spellcheck=false;headers.className='wide';headers.append(headerInput);
      headers.append(make('span','Example: {"authorization":"MY_API_AUTH"}. Set the complete header value in that environment variable before launch.','hint'));
      const alternatives=op.security.length?op.security.map((names,i)=>[i,names.length?names.join(' + '):'No additional backend authentication']):[[0,'No additional backend authentication']];
      const security=selectField('Backend security alternative',alternatives,previous?.securityAlternative??0);
      const mode=selectField('Response format',[['json','JSON'],['bytes','Bytes']],previous?.responseMode??'json');
      const timeout=field('Backend timeout, milliseconds',previous?.timeoutMs??10000,'number');
      const size=field('Maximum response bytes',previous?.maxResponseBytes??1048576,'number');
      const capacity=field('Concurrent backend requests',previous?.maxInFlight??16,'number');
      fields.append(headers,security.container,mode.container,timeout.container,size.container,capacity.container);
      advanced.append(summary,fields);settings.append(advanced);card.append(settings);
      const controls=[server.input,amount.input,headerInput,security.input,mode.input,timeout.input,size.input,capacity.input];
      const toggle=()=>{controls.forEach(c=>{c.disabled=!check.checked;});};
      check.addEventListener('change',toggle);toggle();
      routeFields.push({op,previous,check,server:server.input,amount:amount.input,headers:headerInput,security:security.input,mode:mode.input,timeout:timeout.input,size:size.input,capacity:capacity.input});
    }
    $('routes').append(card);
  }
  if(!inspection.operations.length)$('routes').append(make('p','This document contains no HTTP operations.','empty'));
}
function planFromForm() {
  return {schema:'stellar-forge.api-merchant-plan.v1',sellerServer:$('seller-server').value.trim(),serviceName:$('service-name').value.trim(),
    payment:{network:$('network').value.trim(),asset:$('asset').value.trim(),payTo:$('recipient').value.trim(),maxTimeoutSeconds:Number($('payment-timeout').value)},
    allowLoopbackUpstream:$('allow-loopback').checked,
    operations:routeFields.filter(r=>r.check.checked).map(r=>({method:r.op.method,path:r.op.path,
      ...(r.previous?.id?{id:r.previous.id}:{}),serverIndex:Number(r.server.value),amountAtomic:r.amount.value.trim(),headerEnv:JSON.parse(r.headers.value),
      securityAlternative:Number(r.security.value),responseMode:r.mode.value,timeoutMs:Number(r.timeout.value),maxResponseBytes:Number(r.size.value),maxInFlight:Number(r.capacity.value)}))};
}
function fillPlan(plan) {
  $('seller-server').value=plan?.sellerServer??'';
  $('service-name').value=plan?.serviceName??'';
  $('network').value=plan?.payment?.network??'stellar:testnet';
  $('asset').value=plan?.payment?.asset??'';
  $('recipient').value=plan?.payment?.payTo??'';
  $('payment-timeout').value=plan?.payment?.maxTimeoutSeconds??60;
  $('allow-loopback').checked=plan?.allowLoopbackUpstream===true;
  drawRoutes(plan?.operations??[]);
}
async function loadSource(text,plan) {
  const info=await api('inspect',{specText:text});
  specText=text;inspection=info;selectedPackage=null;
  $('source-summary').textContent=info.title+' · OpenAPI '+info.version+' · '+countLabel(info.operations.length,'operation');
  fillPlan(plan);dirty();available();
}
function preview(value) {
  const table=make('table'),thead=make('thead'),head=make('tr');
  for(const title of ['Route','Public seller','Backend target','Atomic price'])head.append(make('th',title));
  thead.append(head);table.append(thead);const rows=make('tbody');
  for(const route of value.routes) {
    const row=make('tr');
    for(const text of [route.method+' '+route.path,route.publicUrl,route.upstream,route.amountAtomic+' / '+route.network])row.append(make('td',text));
    rows.append(row);
  }
  table.append(rows);const wrap=make('div',undefined,'table-wrap');wrap.tabIndex=0;wrap.setAttribute('role','region');wrap.setAttribute('aria-label','Selected route terms');wrap.append(table);
  $('review').replaceChildren(make('p',countLabel(value.routes.length,'route')+' accepted by the original seller compiler.','small'),wrap,
    make('p','Required environment variables: '+(value.environment.join(', ')||'none')+'. Actual credential values are checked when the seller starts.','hint'));
}
function saved(name) {
  selectedPackage=name;$('run-label').textContent='Saved package: '+name;available();
}
function runtime(value) {
  $('runtime').replaceChildren();$('stop').disabled=value.state!=='RUNNING';
  if(value.state!=='RUNNING'){$('runtime').append(make('p','No seller is managed by this workspace.','small'));return;}
  const mode=value.mode==='CHALLENGE_ONLY'?'Challenge preview':value.mode==='NATIVE_X402'?'Native seller':'Seller running';
  $('runtime').append(make('p',value.name+' · '+mode));
  for(const [text,url] of [['Open operations dashboard',value.operations],['Inspect seller offers',value.seller+'/_seller/offers']]) {
    const parsed=new URL(url);
    if(parsed.protocol==='http:'&&parsed.hostname==='127.0.0.1') {
      const link=make('a',text);link.href=url;link.target='_blank';link.rel='noopener';link.referrerPolicy='origin';$('runtime').append(link);
    }
  }
}
async function refresh() {
  const result=await api('packages');$('packages').replaceChildren();
  for(const project of result.packages) {
    const button=make('button',undefined,'project');button.type='button';button.append(make('strong',project.name),
      make('span',project.title+' · '+countLabel(project.routes,'route')));
    button.addEventListener('click',()=>act(async()=>{
      const loaded=await api('load?name='+encodeURIComponent(project.name));
      await loadSource(loaded.specText,loaded.plan);preview(loaded.preview);saved(loaded.name);
      $('package-name').value=loaded.name;
      notice('Reopened '+loaded.name+'. Save edits under a new package name.');
    }));$('packages').append(button);
  }
  if(!result.packages.length)$('packages').append(make('p','No saved projects yet.','small'));
  $('output').textContent='Output: '+result.output;runtime(result.runtime);
}
$('file').addEventListener('change',()=>act(async()=>{
  const file=$('file').files[0];if(!file)return;
  if(file.size>4*1024*1024)throw new Error('OpenAPI JSON must be at most 4 MiB');
  const data=await file.arrayBuffer(),text=new TextDecoder('utf-8',{fatal:true}).decode(data);
  await loadSource(text);notice('API description loaded. Select the routes and enter your terms.');
}));
$('example').addEventListener('click',()=>act(async()=>{
  const example=await api('example');await loadSource(example.specText,example.plan);
  notice('Example loaded with nonpayable demonstration terms. Configure your own API and payment destination for a real merchant.');
}));
$('configuration').addEventListener('input',dirty);
$('routes').addEventListener('input',dirty);
$('preview').addEventListener('click',()=>act(async()=>{
  const result=await api('preview',{specText,plan:planFromForm()});preview(result);notice('Configuration accepted. Review the exact routes, then save a new package.');
}));
$('save').addEventListener('click',()=>act(async()=>{
  const result=await api('save',{specText,plan:planFromForm(),name:$('package-name').value.trim()});
  preview(result.preview);saved(result.name);$('saved-path').textContent='Saved to '+result.folder+'\n\nStart from a shell:\n'+result.command;$('saved-path').hidden=false;
  await refresh();notice('Saved '+result.name+'. The compiled seller and private configuration are ready.');
}));
async function start(native) {
  if(!selectedPackage)throw new Error('Save or reopen a package first');
  const name=selectedPackage;
  const result=await api('start',{name,...(native?{facilitator:$('facilitator').value.trim()}:{})});
  runtime(result);notice('Seller and operations dashboard started for '+name+'.');
}
$('start-preview').addEventListener('click',()=>act(()=>start(false)));
$('start-native').addEventListener('click',()=>act(()=>start(true)));
$('facilitator').addEventListener('input',available);
$('stop').addEventListener('click',()=>act(async()=>{runtime(await api('stop',{}));notice('Managed seller and operations dashboard stopped. The saved package is retained.');}));
$('refresh').addEventListener('click',()=>act(async()=>{await refresh();notice('Projects refreshed.');}));
if(!/^[0-9a-f]{64}$/.test(token))notice('Open the complete local workspace URL, including its fragment, printed by the launcher.',true);
else act(async()=>{await refresh();notice('Ready. Load an OpenAPI description or reopen a saved project.');});
setInterval(()=>{if(!busy&&token)api('status').then(runtime).catch(()=>{});},10000);

