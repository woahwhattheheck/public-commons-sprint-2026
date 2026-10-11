const $=selector=>document.querySelector(selector);
const token=location.hash.slice(1)||sessionStorage.getItem('mpp-session');
if(location.hash){sessionStorage.setItem('mpp-session',token);history.replaceState(null,'',location.pathname);}
let state,loaded=false,busy=false;
const node=(tag,text,className)=>{const e=document.createElement(tag);if(text!==undefined)e.textContent=text;if(className)e.className=className;return e;};
const notify=text=>{$('#notice').textContent=text;};
async function api(path,body) {
  if(!token)throw new Error('Open the private workspace URL printed by the operator command.');
  const response=await fetch(path,{method:body===undefined?'GET':'POST',
    headers:{authorization:'Bearer '+token,...(body===undefined?{}:{'content-type':'application/json'})},
    ...(body===undefined?{}:{body:JSON.stringify(body)})});
  const result=await response.json();if(!response.ok)throw new Error(result.error||'Operation failed');return result;
}
async function action(path,body) {
  try{const result=await api(path,body);notify(result.id?'Operation started. Approval prompts appear in the operator terminal.':'Configuration updated.');await refresh();return result;}
  catch(error){notify(error.message);}
}
function button(text,fn){const b=node('button',text);b.type='button';b.addEventListener('click',()=>Promise.resolve(fn()).catch(e=>notify(e.message)));return b;}
function setForm(form,values){for(const [key,value]of Object.entries(values)){const field=form.elements.namedItem(key);if(field)field.value=value??'';}}
function formValues(form){return Object.fromEntries(new FormData(form));}
function cut(value){return value?value.slice(0,12)+'…':'—';}
function detail(row){$('#details').textContent=JSON.stringify(row,null,2);$('#details').parentElement.open=true;}
function renderTable(target,rows,render) {
  const body=$(target);body.replaceChildren();
  if(!rows.length){const tr=node('tr'),td=node('td','No operations yet.','empty');td.colSpan=6;tr.append(td);body.append(tr);}
  else rows.forEach(row=>{const tr=node('tr');render(row).forEach(value=>{const td=node('td');if(value instanceof Node)td.append(value);else td.textContent=value??'—';tr.append(td);});body.append(tr);});
}
async function download(group,id) {
  const response=await fetch('/api/'+group+'/'+encodeURIComponent(id)+'/response',{headers:{authorization:'Bearer '+token}});
  if(!response.ok)throw new Error((await response.json()).error);
  const url=URL.createObjectURL(await response.blob()),link=node('a');link.href=url;link.download=id+'.bin';link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
}
function render() {
  $('#connection').textContent='Connected · revision '+state.metadata.revision;
  $('#versions').textContent=Object.entries(state.versions).map(([name,version])=>name+' '+version).join(' · ');
  $('#metrics').replaceChildren(...[
    [state.purchases.length,'Purchases prepared'],
    [state.deliveries.filter(r=>r.state==='COMPLETE').length,'Deliveries completed'],
    [state.purchases.filter(r=>['FINALIZED','IDEMPOTENT_FINALIZED'].includes(r.finality?.outcome)).length,'Purchases reconciled'],
    [state.jobs.filter(r=>r.state==='RUNNING').length,'Active operations']
  ].map(([number,label])=>{const e=node('div',undefined,'metric');e.append(node('strong',String(number)),node('span',label));return e;}));
  renderTable('#purchases',state.purchases,row=>{
    const controls=node('div');
    controls.append(button('Details',()=>detail(row)));
    if(['REVIEW_READY','RESERVING','RESERVED','SIGNING'].includes(row.phase))controls.append(button('Execute',()=>action('/api/purchase/execute',{id:row.id})));
    if(row.transaction){controls.append(button('Recover',()=>action('/api/purchase/resume',{id:row.id})),button('Reconcile',()=>action('/api/purchase/finalize',{id:row.id})));}
    if(row.response)controls.append(button('Download',()=>download('purchases',row.id)));
    return [row.id,node('span',row.phase,'badge'),row.challenge?.request?.amount,
      row.response?row.response.status+' · '+row.response.bytes+' bytes':'Awaiting response',row.finality?.outcome||'Pending',controls];
  });
  renderTable('#deliveries',state.deliveries,row=>{
    const controls=node('div');controls.append(button('Details',()=>detail(row)));
    if(row.state!=='COMPLETE')controls.append(button('Recover delivery',()=>action('/api/delivery/recover',{id:row.id})));
    if(row.response)controls.append(button('Download',()=>download('deliveries',row.id)));
    return [cut(row.id),row.routeId,node('span',row.state,'badge'),cut(row.transaction),row.response?row.response.bytes+' bytes':'Pending',controls];
  });
  $('#jobs').replaceChildren(...state.jobs.slice().reverse().map(job=>{
    const e=node('div',undefined,'job');e.append(node('strong',job.kind),node('span',job.error||job.state,'mono'),
      button('Details',()=>detail(job)));return e;
  }));
  if(!state.jobs.length)$('#jobs').append(node('p','No operations in this session.'));
  $('#merchant-runtime').textContent=state.merchant?'Running on 127.0.0.1:'+state.merchant.port+' · profile '+cut(state.merchant.profileId):'Merchant listener stopped';
  $('#merchant-start').disabled=!!state.merchant;$('#merchant-stop').disabled=!state.merchant;
  $('#prepare').disabled=!state.profiles.buyer;
}
function field(name,label,value='',type='text') {
  const wrap=node('label',label),input=node('input');input.name=name;input.type=type;input.value=value;wrap.append(input);return wrap;
}
function addRoute(value={}) {
  const payment=value.payment||{},resource=value.resource||{kind:'json',value:{status:'ready'}};
  const card=node('div',undefined,'route'),heading=node('div',undefined,'heading');
  heading.append(node('h3','Payment route'),button('Remove',()=>card.remove()));card.append(heading);
  const grid=node('div',undefined,'grid');
  for(const [name,label,v,type]of [
    ['id','Route ID',value.id||'data'],['method','HTTP method',value.method||'GET'],
    ['path','Path',value.path||'/data'],['description','Description',value.description||'Data response'],
    ['network','Network',payment.network||'stellar:testnet'],['currency','Token contract',payment.currency||''],
    ['recipient','Recipient',payment.recipient||''],['amountAtomic','Atomic price',payment.amountAtomic||'100000'],
    ['decimals','Token decimals',payment.decimals??7,'number']
  ])grid.append(field(name,label,v,type));
  card.append(grid);
  const label=node('label','Resource configuration'),area=node('textarea');area.name='resource';area.rows=6;area.spellcheck=false;area.value=JSON.stringify(resource,null,2);label.append(area);card.append(label);$('#routes').append(card);
}
function loadForms() {
  const merchant=state.profiles.merchant;
  if(merchant){setForm($('#merchant-form'),merchant);merchant.routes.forEach(addRoute);}else addRoute();
  const buyer=state.profiles.buyer;
  if(buyer)setForm($('#buyer-form'),{intentId:buyer.intentId,url:buyer.request.url,method:buyer.request.method,
    requestJson:Object.hasOwn(buyer.request,'json')?JSON.stringify(buyer.request.json,null,2):'',
    ...buyer.expect,...buyer.signer,...buyer.operator,dependencyRoot:buyer.dependencyRoot,
    rpcUrl:buyer.rpcUrl,proxyEnv:buyer.transport?.proxyEnv});
}
async function refresh() {
  if(busy)return;busy=true;
  try{state=await api('/api/state');render();if(!loaded){loadForms();loaded=true;}}
  catch(error){$('#connection').textContent='Connection unavailable';notify(error.message);}
  finally{busy=false;}
}
$('#merchant-form').addEventListener('submit',async event=>{
  event.preventDefault();
  try{
    const values=formValues(event.currentTarget),routes=[...document.querySelectorAll('.route')].map(card=>{
      const read=name=>card.querySelector('[name="'+name+'"]').value;
      return {id:read('id'),method:read('method'),path:read('path'),description:read('description'),
        payment:{network:read('network'),currency:read('currency'),recipient:read('recipient'),
          amountAtomic:read('amountAtomic'),decimals:Number(read('decimals'))},resource:JSON.parse(read('resource'))};
    });
    const profile={title:values.title,publicOrigin:values.publicOrigin,dependencyRoot:values.dependencyRoot,
      secretEnv:values.secretEnv,lifetimeSeconds:Number(values.lifetimeSeconds),routes,
      ...(values.rpcUrl?{rpcUrl:values.rpcUrl}:{}),...(values.handlersModule?{handlersModule:values.handlersModule}:{})};
    await action('/api/profile',{kind:'merchant',profile,revision:state.metadata.revision});
  }catch(error){notify(error.message);}
});
$('#buyer-form').addEventListener('submit',async event=>{
  event.preventDefault();
  try{
    const v=formValues(event.currentTarget);
    const profile={intentId:v.intentId,request:{url:v.url,method:v.method,...(v.requestJson.trim()?{json:JSON.parse(v.requestJson)}:{})},
      expect:{network:v.network,currency:v.currency,recipient:v.recipient,maxAtomic:v.maxAtomic,
        realm:v.realm,decimals:Number(v.decimals),maxFeeStroops:v.maxFeeStroops},
      signer:{payer:v.payer,keyEnv:v.keyEnv},dependencyRoot:v.dependencyRoot,
      operator:{python:v.python,ledger:v.ledger,policy:v.policy,actor:v.actor,service:v.service},
      ...(v.rpcUrl?{rpcUrl:v.rpcUrl}:{}),
      ...(v.proxyEnv?{transport:{mode:'explicit-connect',origin:new URL(v.url).origin,proxyEnv:v.proxyEnv}}:{})};
    await action('/api/profile',{kind:'buyer',profile,revision:state.metadata.revision});
  }catch(error){notify(error.message);}
});
document.querySelectorAll('[data-tab]').forEach(button=>button.addEventListener('click',()=>{
  document.querySelectorAll('.panel').forEach(panel=>panel.hidden=panel.id!==button.dataset.tab);
  document.querySelectorAll('[data-tab]').forEach(tab=>tab.classList.toggle('selected',tab===button));
}));
$('#add-route').addEventListener('click',()=>addRoute());
$('#merchant-start').addEventListener('click',()=>action('/api/merchant/start',{port:Number($('#merchant-port').value)}));
$('#merchant-stop').addEventListener('click',()=>action('/api/merchant/stop',{}));
$('#prepare').addEventListener('click',()=>action('/api/purchase/prepare',{}));
$('#refresh').addEventListener('click',refresh);
await refresh();setInterval(()=>{if(!document.hidden)refresh();},3000);
