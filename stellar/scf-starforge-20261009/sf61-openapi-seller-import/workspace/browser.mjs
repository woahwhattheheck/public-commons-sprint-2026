import { createAuthenticationPanel, appendAuthenticationReview, renderCredentialRuntime } from './authentication-browser.mjs';
import { createOperationSettings, createOperationPanel } from './operation-panel.mjs';
import { createRevisionDesk } from './revision-browser.mjs';
import { createStreamSettings, isStreamFormat, merchantResponseLabel } from './stream-browser.mjs';
import { createStreamCustomerPanel } from './stream-customer-browser.mjs';
import { createPostmanPanel, mergePostmanMerchantPlan } from '/postman-browser.mjs';
const $=id=>document.getElementById(id);
const countLabel=(n,label)=>n+' '+label+(n===1?'':'s');
const token=location.hash.slice(1);
$('migration-link').href='/migrations/#'+token;
let specText='', inspection=null, routeFields=[], selectedPackage=null, busy=false, customerOpen=false, revisionDesk=null;
const notice=(message,error=false)=>{$('notice').textContent=message;$('notice').classList.toggle('error',error);};
const make=(tag,text,cls)=>{const e=document.createElement(tag);if(text!==undefined)e.textContent=text;if(cls)e.className=cls;return e;};
async function api(path,body) {
  const form=body instanceof FormData;
  const response=await fetch('/api/'+path,{method:body===undefined?'GET':'POST',headers:{'x-workspace-token':token,...(body===undefined||form?{}:{'content-type':'application/json'})},...(body===undefined?{}:{body:form?body:JSON.stringify(body)})});
  const value=await response.json();
  if(!response.ok)throw new Error(value.error??'Workspace request failed');
  return value;
}
function available() {
  $('preview').disabled=busy||!specText;
  $('save').disabled=busy||!specText;
  $('start-preview').disabled=busy||!selectedPackage||customerOpen;
  $('start-native').disabled=busy||!selectedPackage||customerOpen||!$('facilitator').value.trim();
  postmanPanel.refresh(busy);
  revisionDesk?.available(busy);
}
function dirty() {
  selectedPackage=null;
  $('run-label').textContent='Save this configuration as a new package before starting it.';
  $('saved-path').hidden=true;
  $('review').replaceChildren();
  customerPanel.clear();
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
const operationPanel=createOperationPanel({container:$('operation-runtime'),make,field,api,act,notice});
revisionDesk=createRevisionDesk({container:$('source-revisions'),api,act,notice,onSaved:async(result,configuration)=>{
  await loadSource(configuration.specText,configuration.plan);preview(result.preview);await saved(result.name,result);
  $('package-name').value=result.name;$('saved-path').textContent='Saved to '+result.folder+'\n\n'+result.command;$('saved-path').hidden=false;
  await refresh();
}});
function checkField(label,value) {
  const container=make('label',undefined,'check wide'),input=make('input');
  input.type='checkbox';input.checked=value===true;container.append(input,make('span',label));return {container,input};
}
function selectField(label,values,value) {
  const container=make('label',label),input=make('select');
  for(const [key,text] of values){const o=make('option',text);o.value=String(key);input.append(o);}
  input.value=String(value??values[0]?.[0]??'');container.append(input);return {container,input};
}
function createQuerySettings(op,previous) {
  const saved=structuredClone(previous?.querySerialization??{});
  const declared=new Map((op.queryParameters??[]).filter(p=>typeof p.name==='string').map(p=>[p.name,p]));
  const arrays=[...declared.values()].filter(p=>p.type==='array');
  const names=[...new Set([...arrays.map(p=>p.name),...Object.keys(saved)])];
  const element=make('details',undefined,'wide'),fields=make('div',undefined,'fields'),inputs=new Map();
  element.hidden=!names.length;
  element.append(make('summary','Array query format'),
    make('p','Choose how the provider receives each list: repeated keys or one comma-separated value. Use source keeps the declared format. Explicit choices are retained with this merchant package.','hint'),fields);
  for(const name of names) {
    const parameter=declared.get(name),original=saved[name];
    const source=parameter?(parameter.style==='form'?(parameter.explode?'repeated keys':'comma-separated'):'style '+parameter.style):null;
    const choices=[['source',parameter?'Use source ('+source+')':'Remove saved override'],
      ['repeat','Repeated keys: field=a&field=b'],['comma','Comma-separated: field=a,b']];
    let value='source';
    if(Object.hasOwn(saved,name)) {
      if(original?.style==='form'&&typeof original.explode==='boolean')value=original.explode?'repeat':'comma';
      else {choices.push(['retain','Keep saved format']);value='retain';}
    }
    const control=selectField(name,choices,value);control.input.setAttribute('aria-label','Query format for '+name);
    control.input.dataset.queryParameter=name;
    if(parameter?.description)control.container.append(make('span',parameter.description,'hint'));
    if(parameter?.error)control.container.append(make('span','Source declaration: '+parameter.error,'hint'));
    if(!parameter)control.container.append(make('span','This saved setting is absent from the current source inventory. It remains in the plan until you remove it.','hint'));
    if(value==='retain')control.container.append(make('span',JSON.stringify(original),'hint'));
    fields.append(control.container);inputs.set(name,control.input);
  }
  let enabled=false,bulk=null,apply=null;
  if(arrays.length>1) {
    bulk=selectField('Apply one format to this operation’s array parameters',
      [['','Choose a format'],['source','Use each source setting'],['repeat','Repeated keys'],['comma','Comma-separated']],'');
    bulk.container.className='wide';apply=make('button','Apply to array parameters');apply.type='button';
    bulk.container.append(apply);element.insertBefore(bulk.container,fields);
    bulk.input.addEventListener('change',()=>{apply.disabled=!enabled||!bulk.input.value;});
    apply.addEventListener('click',()=>{
      if(!enabled||!bulk.input.value)return;
      for(const parameter of arrays)inputs.get(parameter.name).value=bulk.input.value;
      dirty();
    });
  }
  return {element,setEnabled(value) {
    enabled=value;
    for(const input of inputs.values())input.disabled=!enabled;
    if(bulk){bulk.input.disabled=!enabled;apply.disabled=!enabled||!bulk.input.value;}
  },read() {
    const parameters=structuredClone(saved);
    for(const [name,input] of inputs) {
      if(input.value==='source')delete parameters[name];
      else if(input.value==='repeat'||input.value==='comma')parameters[name]={style:'form',explode:input.value==='repeat'};
    }
    return Object.keys(parameters).length?{querySerialization:parameters}:{};
  }};
}
const customerPanel=createStreamCustomerPanel({container:$('stream-customer-content'),make,field,selectField,api,act,notice});
const postmanPanel=createPostmanPanel({container:$('postman-intake'),api,act,notice,
  async onSource(text,operations) {
    const current=mergePostmanMerchantPlan({currentSource:specText,source:text,currentPlan:planFromForm(),operations});
    await loadSource(text,current);
  }});
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
      const description=field('Public description',previous?.publicDescription??op.publicDescription??'');
      description.container.className='wide';settings.append(description.container);
      if (op.requestBody) settings.append(make('p',op.requestBody.mediaType+' · Whole body '+(op.requestBody.required?'required':'optional')+
        (op.requestBody.fields?.some(field=>field.file)?' · File fields: '+op.requestBody.fields.filter(field=>field.file).map(field=>field.name+(field.required?' (required when sent)':'')).join(', '):''),'hint wide'));
      const advanced=make('details'),summary=make('summary','Backend credentials and response settings'),fields=make('div',undefined,'fields');
      const headers=make('label','Header → environment variable references'),headerInput=make('textarea');
      headerInput.value=JSON.stringify(previous?.headerEnv??{},null,2);headerInput.spellcheck=false;headers.className='wide';headers.append(headerInput);
      headers.append(make('span','Example: {"authorization":"MY_API_AUTH"}. Set the complete header value in that environment variable before launch.','hint'));
      const alternatives=(op.authentication??[]).map(value=>[value.index,(value.names.length?value.names.join(' + '):'No additional backend authentication')+(value.supported?'':' (setup unavailable)')]);
      const security=selectField('Backend security alternative',alternatives,previous?.securityAlternative??0);
      const formats=[['json','JSON'],['bytes','Bytes'],...(op.method==='HEAD'?[]:(op.responseStreams??[]).map(value=>[value.format,value.format.toUpperCase()+' stream']))];
      const mode=selectField('Response format',formats,previous?.responseMode??'json');
      const validation=selectField('Response validation',[['declared','Match declared OpenAPI response'],['none','Transport limits only']],previous?previous.responseValidation??(previous.enforceResponseContract===true?'declared':'none'):'declared');
      if(mode.input.value!=='json')validation.input.value='none';
      const stream=createStreamSettings({make,field},previous);
      const request=make('label','Public request example'),requestInput=make('textarea');request.className='wide';
      requestInput.value=previous?.requestExample===undefined?'':JSON.stringify(previous.requestExample,null,2);requestInput.spellcheck=false;
      requestInput.placeholder=['POST','PUT','PATCH'].includes(op.method)?'{"pathParams":{},"query":{},"body":{}}':'{"pathParams":{},"query":{}}';
      request.append(requestInput,make('span','Reusable public sample values. Declare pathParams, query and body fields from this operation. For multipart files, use a harmless string sample; select actual private files only in the running operation form.','hint'));
      const timeout=field('Backend timeout, milliseconds',previous?.timeoutMs??10000,'number');
      const size=field('Maximum response bytes',previous?.maxResponseBytes??1048576,'number');
      const requestSize=field('Maximum request bytes',previous?.maxRequestBytes??1048576,'number');
      requestSize.input.min='1';requestSize.input.max=String(16*1024*1024);
      requestSize.container.append(make('span','Up to 16 MiB including multipart framing. The default is 1 MiB.','hint'));
      const capacity=field('Concurrent backend requests',previous?.maxInFlight??16,'number');
      const forwarded=field('Forward ordinary request headers',previous?.requestHeaders?.join(', ')??'');
      forwarded.input.placeholder='accept-language, x-region';
      forwarded.container.append(make('span','Comma-separated names. Credentials and payment headers cannot be forwarded. Shared reads vary on every forwarded header.','hint'));
      const guard=checkField('Pause paid admission after repeated backend failures',previous?.availability!==undefined);
      const failureThreshold=field('Failures before pausing',previous?.availability?.failureThreshold??3,'number');
      const resetAfter=field('Initial recovery wait, milliseconds',previous?.availability?.resetAfterMs??30000,'number');
      const maxResetAfter=field('Maximum recovery wait, milliseconds',previous?.availability?.maxResetAfterMs??300000,'number');
      fields.append(headers,security.container,mode.container,validation.container,timeout.container,size.container,requestSize.container,capacity.container,
        stream.element,request,forwarded.container,guard.container,failureThreshold.container,resetAfter.container,maxResetAfter.container);
      if(op.streamError) fields.append(make('p','Stream declaration: '+op.streamError,'hint wide'));
      advanced.append(summary,fields);settings.append(advanced);card.append(settings);
      const authentication=createAuthenticationPanel({operation:op,definitions:inspection.backendSecurity??[],previous,
        server:server.input,security:security.input,make,field,selectField});settings.append(authentication.element);
      let cache=null;
      if(['GET','HEAD'].includes(op.method)) {
        const section=make('details'),cacheFields=make('div',undefined,'fields');
        const enabled=checkField('Share this read-only result across buyers with the same request',previous?.cache?.shareAcrossBuyers);
        const definitions=[['ttlMs','Maximum freshness, milliseconds',1000],['maxEntries','Maximum retained responses',256],
          ['maxBytes','Total cache bytes',16777216],['maxEntryBytes','Largest retained response, bytes',1048576],
          ['maxWaiters','Maximum waiting buyers',128],['sourceTimeoutMs','Shared source timeout, milliseconds',11000]];
        cache={enabled:enabled.input,values:{}};cacheFields.append(enabled.container);
        for(const [name,label,fallback] of definitions) {
          const option=field(label,previous?.cache?.[name]??fallback,'number');option.input.min='1';
          cache.values[name]=option.input;cacheFields.append(option.container);
        }
        section.append(make('summary','Shared read results'),
          make('p','Enable only when this API result may be reused by different buyers. Native payment remains per delivery. Origin privacy and freshness rules can shorten or prevent reuse.','hint'),cacheFields);
        settings.append(section);
      }
      const query=createQuerySettings(op,previous);settings.append(query.element);
      const operation=createOperationSettings({make,field},previous,op.method);
      if(operation)settings.append(operation.element);
      const controls=[server.input,amount.input,description.input,requestInput,validation.input,headerInput,security.input,mode.input,timeout.input,size.input,requestSize.input,capacity.input,forwarded.input,guard.input];
      const guardControls=[failureThreshold.input,resetAfter.input,maxResetAfter.input];
      const toggle=()=>{
        const streaming=isStreamFormat(mode.input.value);
        controls.forEach(c=>{c.disabled=!check.checked;});
        validation.input.disabled=!check.checked||mode.input.value!=='json';
        size.container.hidden=streaming;
        stream.setEnabled(check.checked,mode.input.value);
        guardControls.forEach(c=>{c.disabled=!check.checked||!guard.input.checked;});
        authentication.toggle(check.checked);
        query.setEnabled(check.checked);
        operation?.setEnabled(check.checked&&!streaming);
        if(cache){cache.enabled.disabled=!check.checked||streaming;Object.values(cache.values).forEach(c=>{c.disabled=!check.checked||!cache.enabled.checked||streaming;});}
      };
      check.addEventListener('change',toggle);guard.input.addEventListener('change',toggle);
      mode.input.addEventListener('change',()=>{if(mode.input.value!=='json')validation.input.value='none';toggle();});
      cache?.enabled.addEventListener('change',toggle);toggle();
      routeFields.push({op,previous,check,server:server.input,amount:amount.input,description:description.input,request:requestInput,validation:validation.input,headers:headerInput,security:security.input,
        mode:mode.input,timeout:timeout.input,size:size.input,requestSize:requestSize.input,capacity:capacity.input,forwarded:forwarded.input,
        guard:guard.input,failureThreshold:failureThreshold.input,resetAfter:resetAfter.input,maxResetAfter:maxResetAfter.input,cache,authentication,operation,stream,query});
    }
    $('routes').append(card);
  }
  if(!inspection.operations.length)$('routes').append(make('p','This document contains no HTTP operations.','empty'));
}
function planFromForm() {
  return {schema:'stellar-forge.api-merchant-plan.v1',sellerServer:$('seller-server').value.trim(),serviceName:$('service-name').value.trim(),
    payment:{network:$('network').value.trim(),asset:$('asset').value.trim(),payTo:$('recipient').value.trim(),maxTimeoutSeconds:Number($('payment-timeout').value),paymentFlow:$('payment-flow').value},
    allowLoopbackUpstream:$('allow-loopback').checked,
    operations:routeFields.filter(r=>r.check.checked).map(r=>({method:r.op.method,path:r.op.path,
      ...(r.previous?.id?{id:r.previous.id}:{}),serverIndex:Number(r.server.value),amountAtomic:r.amount.value.trim(),headerEnv:JSON.parse(r.headers.value),
      publicDescription:r.description.value.trim(),responseValidation:r.validation.value,
      ...(r.request.value.trim()?{requestExample:JSON.parse(r.request.value)}:{}),
      ...r.query.read(),
      ...r.authentication.toPlan(),
      ...(!isStreamFormat(r.mode.value)&&r.operation?.read()?{idempotency:r.operation.read()}:{}),
      securityAlternative:Number(r.security.value),responseMode:r.mode.value,timeoutMs:Number(r.timeout.value),
      ...(isStreamFormat(r.mode.value)?{stream:r.stream.read()}:{maxResponseBytes:Number(r.size.value)}),maxRequestBytes:Number(r.requestSize.value),maxInFlight:Number(r.capacity.value),
      requestHeaders:r.forwarded.value.split(',').map(v=>v.trim().toLowerCase()).filter(Boolean),
      ...(r.guard.checked?{availability:{failureThreshold:Number(r.failureThreshold.value),resetAfterMs:Number(r.resetAfter.value),maxResetAfterMs:Number(r.maxResetAfter.value)}}:{}),
      ...(!isStreamFormat(r.mode.value)&&r.cache?.enabled.checked?{cache:{shareAcrossBuyers:true,...Object.fromEntries(Object.entries(r.cache.values).map(([name,input])=>[name,Number(input.value)])),
        ...(r.previous?.cache?.maxSourceInFlight!==undefined?{maxSourceInFlight:r.previous.cache.maxSourceInFlight}:{})}}:{})}))};
}
function fillPlan(plan) {
  $('seller-server').value=plan?.sellerServer??'';
  $('service-name').value=plan?.serviceName??'';
  $('network').value=plan?.payment?.network??'stellar:testnet';
  $('asset').value=plan?.payment?.asset??'';
  $('recipient').value=plan?.payment?.payTo??'';
  $('payment-timeout').value=plan?.payment?.maxTimeoutSeconds??60;
  $('payment-flow').value=plan?.payment?.paymentFlow??'authorization';
  $('allow-loopback').checked=plan?.allowLoopbackUpstream===true;
  drawRoutes(plan?.operations??[]);
}
async function loadSource(text,plan) {
  const info=await api('inspect',{specText:text});
  specText=text;inspection=info;selectedPackage=null;
  $('source-summary').textContent=info.title+' · OpenAPI '+info.version+' · '+countLabel(info.operations.length,'operation');
  fillPlan(plan);dirty();available();
  await postmanPanel.reopen(text);
}
function preview(value) {
  const table=make('table'),thead=make('thead'),head=make('tr');
  for(const title of ['Route','Public seller','Backend target','Request','Atomic price','Response','Read policy'])head.append(make('th',title));
  thead.append(head);table.append(thead);const rows=make('tbody');
  for(const route of value.routes) {
    const row=make('tr');
    const cache=route.cache?`Shared for at most ${route.cache.ttlMs} ms · ${route.cache.maxEntries} entries · ${route.cache.maxBytes} bytes`:'Fresh backend request';
    for(const text of [route.method+' '+route.path,route.publicUrl,route.upstream,route.requestBody?route.requestBody.mediaType+' · '+(route.requestBody.required?'required':'optional')+' · '+route.maxRequestBytes+' bytes':'No body',route.amountAtomic+' / '+route.network,
      merchantResponseLabel(route)+' · '+(route.paymentFlow??'authorization')+' payment',cache])row.append(make('td',text));
    rows.append(row);
  }
  table.append(rows);const wrap=make('div',undefined,'table-wrap');wrap.tabIndex=0;wrap.setAttribute('role','region');wrap.setAttribute('aria-label','Selected route terms');wrap.append(table);
  $('review').replaceChildren(make('p',countLabel(value.routes.length,'route')+' accepted by the original seller compiler.','small'),wrap,
    make('p','Required environment variables: '+(value.environment.join(', ')||'none')+'. Actual credential values are checked when the seller starts.','hint'));
  if(value.routeChecks){const ready=value.routeChecks.filter(r=>r.state==='READY').length;
    $('review').append(make('p',ready+' / '+value.routeChecks.length+' route examples ready for an unpaid check.','small'));
    for(const route of value.routeChecks.filter(r=>r.state!=='READY'))$('review').append(make('p',route.method+' '+route.id+': '+(route.reason==='MULTIPART_REQUIRES_PRIVATE_FILE_REQUEST'?'select and retain an actual private file in the running operation form.':'add a public request example with its path, query and body values.'),'hint'));}
  appendAuthenticationReview($('review'),value.routes,{make});
}
async function saved(name,value) {
  selectedPackage=name;$('run-label').textContent='Saved package: '+name;revisionDesk.selectPackage(name,value);available();
  await customerPanel.setPackage(name);
}
function runtime(value) {
  customerOpen=Boolean(value.customer);customerPanel.renderRuntime(value.customer);available();
  renderCredentialRuntime($('credential-runtime'),value.credentials,{make});
  operationPanel.render(value);
  $('runtime').replaceChildren();$('cache-runtime').replaceChildren();$('stop').disabled=value.state!=='RUNNING';
  $('check-routes').disabled=value.state!=='RUNNING'||value.mode!=='CHALLENGE_ONLY';
  if(value.state!=='RUNNING'){$('runtime').append(make('p','No seller is managed by this workspace.','small'));return;}
  const mode=value.mode==='CHALLENGE_ONLY'?'Challenge preview':value.mode==='NATIVE_X402'?'Native seller':'Seller running';
  $('runtime').append(make('p',value.name+' · '+mode));
  for(const [text,url] of [['Open operations dashboard',value.operations],['Inspect seller offers',value.seller+'/_seller/offers'],
    ...(value.operationConsole?[['Open operation recovery',value.operationConsole]]:[])]) {
    const parsed=new URL(url);
    if(parsed.protocol==='http:'&&parsed.hostname==='127.0.0.1') {
      const link=make('a',text);link.href=url;link.target='_blank';link.rel='noopener';link.referrerPolicy='origin';$('runtime').append(link);
    }
  }
  if(value.acceptance){const result=value.acceptance;$('runtime').append(make('p',result.summary.passed+' / '+result.summary.total+' unpaid routes matched their offers.','small'));
    for(const route of result.routes??[])if(route.state!=='PASS')$('runtime').append(make('p',route.method+' '+route.id+': '+route.issues.join(', '),'hint'));
    $('runtime').append(make('p','Saved review: '+result.out,'hint'));}
  if(value.caches?.length) {
    const table=make('table'),head=make('tr'),body=make('tbody');
    for(const text of ['Shared read','Current cache','Source reads','Backend state','Action'])head.append(make('th',text));
    const thead=make('thead');thead.append(head);table.append(thead,body);
    for(const entry of value.caches) {
      const stats=entry.activity?.cache??{},row=make('tr');
      const label=entry.routes?.map(route=>route.path).join(', ')||entry.binding;
      const state={CLOSED:'Available',OPEN:'Paused',RECOVERY_IN_FLIGHT:'Checking backend',RECOVERY_READY:'Recovery ready'}[entry.availability?.state]??'No automatic pause';
      for(const text of [entry.method+' '+label,
        `${stats.entries??0} entries · ${stats.bytes??0} bytes · ${stats.hits??0} hits · ${stats.coalesced??0} shared requests`,
        `${entry.source?.started??0} total · ${entry.source?.inFlight??0} active`,state])row.append(make('td',text));
      const action=make('td'),button=make('button','Invalidate');button.type='button';button.disabled=busy;
      button.setAttribute('aria-label','Invalidate '+label);
      button.addEventListener('click',()=>act(async()=>{
        runtime(await api('cache/invalidate',{runtimeId:value.runtimeId,binding:entry.binding}));
        notice('Cache invalidated for '+entry.binding+'. New reads use a new generation; already admitted requests finish normally.');
      }));action.append(button);row.append(action);body.append(row);
    }
    const wrap=make('div',undefined,'table-wrap');wrap.tabIndex=0;wrap.setAttribute('role','region');wrap.setAttribute('aria-label','Live upstream caches');wrap.append(table);
    $('cache-runtime').append(make('h3','Shared read operations'),wrap,
      make('p','Cache counts describe the current generation. Source totals span this runtime. Invalidation keeps backend availability and native payments unchanged. Restart starts with an empty cache.','hint'));
  }
}
async function refresh() {
  const result=await api('packages');$('packages').replaceChildren();
  for(const project of result.packages) {
    const button=make('button',undefined,'project');button.type='button';button.append(make('strong',project.name),
      make('span',project.title+' · '+countLabel(project.routes,'route')));
    button.addEventListener('click',()=>act(async()=>{
      const loaded=await api('load?name='+encodeURIComponent(project.name));
      await loadSource(loaded.specText,loaded.plan);preview(loaded.preview);await saved(loaded.name,loaded);
      $('package-name').value=loaded.name;
      notice('Reopened '+loaded.name+'. Save edits under a new package name.');
    }));$('packages').append(button);
  }
  if(!result.packages.length)$('packages').append(make('p','No saved projects yet.','small'));
  $('output').textContent='Output: '+result.output;runtime(result.runtime);await revisionDesk.refresh();
}
$('file').addEventListener('change',()=>act(async()=>{
  const file=$('file').files[0];if(!file)return;
  if(file.size>4*1024*1024)throw new Error('OpenAPI JSON or YAML must be at most 4 MiB');
  const data=await file.arrayBuffer(),text=new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(data);
  await loadSource(text);notice('API description loaded. Select the routes and enter your terms.');
}));
$('example').addEventListener('click',()=>act(async()=>{
  const example=await api('example');await loadSource(example.specText,example.plan);
  notice('Example loaded with nonpayable demonstration terms. Configure your own API and payment destination for a real merchant.');
}));
$('stream-example').addEventListener('click',()=>act(async()=>{
  const example=await api('stream-example');await loadSource(example.specText,example.plan);
  notice('Finite stream example loaded. Run its local backend, then choose your merchant address and payment terms.');
}));
$('configuration').addEventListener('input',dirty);
$('routes').addEventListener('input',dirty);
$('preview').addEventListener('click',()=>act(async()=>{
  const result=await api('preview',{specText,plan:planFromForm()});preview(result);notice('Configuration accepted. Review the exact routes, then save a new package.');
}));
$('save').addEventListener('click',()=>act(async()=>{
  const result=await api('save',{specText,plan:planFromForm(),name:$('package-name').value.trim()});
  preview(result.preview);await saved(result.name);$('saved-path').textContent='Saved to '+result.folder+'\n\nStart from a shell:\n'+result.command;$('saved-path').hidden=false;
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
$('check-routes').addEventListener('click',()=>act(async()=>{const result=await api('accept',{});runtime(result);notice('Original route check completed and saved in this package.');}));
$('refresh').addEventListener('click',()=>act(async()=>{await refresh();notice('Projects refreshed.');}));
if(!/^[0-9a-f]{64}$/.test(token))notice('Open the complete local workspace URL, including its fragment, printed by the launcher.',true);
else act(async()=>{
  await refresh();
  const selected=new URLSearchParams(location.search), migration=selected.get('migration'), source=selected.get('source');
  if(migration&&source) {
    const retained=await api('migrations/source?project='+encodeURIComponent(migration)+'&ref='+encodeURIComponent(source));
    await loadSource(retained.content);
    notice('Loaded '+retained.metadata.name+' from migration '+migration+'. Select its routes and enter your merchant terms.');
  } else notice('Ready. Load an OpenAPI description or reopen a saved project.');
});
setInterval(()=>{if(!busy&&token)api('status').then(runtime).catch(()=>{});},10000);

