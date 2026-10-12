import {RESOLUTION_RECEIVING_BYTES} from './limits.mjs';
// MIT. Customer support stays attached to the original accepted buyer and authenticated host.
const $=id=>document.getElementById(id),key='sf.jobs.resolution.customer';
let token=location.hash.slice(1)||sessionStorage.getItem(key)||'',current=null,entryId=null,busy=false,offset=0,total=0;
if(/^[a-f0-9]{64}$/.test(token)){sessionStorage.setItem(key,token);history.replaceState(null,'',location.pathname);}
$('jobs-link').href='/jobs/#'+token;$('library-link').href='/#'+token;
const node=(tag,value,className)=>{const e=document.createElement(tag);if(value!==undefined)e.textContent=String(value);if(className)e.className=className;return e;};
const say=value=>{$('notice').textContent=value;};
const button=(name,fn)=>{const e=node('button',name);e.type='button';e.onclick=()=>run(fn);return e;};
async function api(path,value){
  const response=await fetch(path,{method:value===undefined?'GET':'POST',headers:{Authorization:'Bearer '+token,
    ...(value===undefined?{}:{'Content-Type':'application/json'})},...(value===undefined?{}:{body:JSON.stringify(value)})});
  const result=await response.json();if(!response.ok)throw new Error(result.error??'Request failed');return result;
}
const path=action=>'/api/job-workspace/jobs/'+entryId+'/resolution'+(action?'/'+action:'');
async function run(fn){
  if(busy)return;busy=true;say('Working…');for(const b of document.querySelectorAll('button'))if(b.id!=='stop')b.disabled=true;
  try{await fn();say('Saved.');}catch(e){say(e.message.replaceAll('_',' '));}
  finally{busy=false;for(const b of document.querySelectorAll('button'))b.disabled=false;$('previous').disabled=offset===0;$('next').disabled=offset+50>=total;}
}
function render(value){
  current=value;$('detail').hidden=false;$('title').textContent=value.jobId;
  const r=value.receipt;$('state').textContent=r?
    'Execution '+r.jobState+' · case '+r.state+' · revision '+r.revision+' · read '+value.retainedReceipt.observedAt:
    'Read the merchant resolution to see the current case.';
  $('payment').textContent=r?r.payment.amountAtomic+' atomic units · '+r.payment.network+'\n'+r.payment.asset:'';
  $('totals').replaceChildren();const t=r?.accounting?.totals;
  if(t)for(const [title,k] of [['Original amount','grossAmountAtomic'],['Returned','refundedAmountAtomic'],['Pending refund','pendingRefundAmountAtomic'],
    ['Remaining','remainingAmountAtomic'],['Recorded cancellation','cancelledAmountAtomic']]){
    const e=node('div',undefined,'number');e.append(node('strong',t[k]),node('span',title));$('totals').append(e);
  }
  $('conversation').replaceChildren();
  const messages=[...(r?.issues??[]).map(i=>({at:i.createdAt,author:'Your issue · '+i.requestedRemedy,message:i.message})),
    ...(r?.messages??[]).map(m=>({at:m.at,author:m.author==='CUSTOMER'?'You':'Merchant',message:m.text})),
    ...(r?.decisions??[]).map(d=>({at:d.at,author:'Merchant decision · '+d.kind+' · '+d.state,message:d.message}))].sort((a,b)=>a.at.localeCompare(b.at));
  for(const m of messages){const e=node('div',undefined,'entry');e.append(node('strong',m.author),node('small',' · '+m.at),node('p',m.message));$('conversation').append(e);}
  $('operations').replaceChildren();
  for(const op of [...value.operations].reverse()){
    const e=node('div',undefined,'entry');e.append(node('strong',op.kind+' · '+op.state),node('p',op.request.message),node('code',op.id));
    if(op.error)e.append(node('p',op.error.code.replaceAll('_',' ')));
    if(op.state!=='RECEIVED')e.append(button('Recover saved outcome',async()=>render(await api(path('recover'),{requestId:op.id}))),
      button('Resume saved request',async()=>render(await api(path('resume'),{requestId:op.id}))));
    $('operations').append(e);
  }
  $('receipt').textContent=JSON.stringify({acceptanceSha256:value.acceptanceSha256,purchaseSha256:value.purchaseSha256,
    retainedReceipt:value.retainedReceipt,receipt:r},null,2);
}
async function load(){
  const result=await api('/api/job-workspace/resolutions?q='+encodeURIComponent($('query').value)+'&offset='+offset+'&limit=50');
  total=result.total;$('jobs').replaceChildren();
  for(const item of result.items){
    const row=node('tr');for(const v of [item.label||item.jobId,item.jobState,item.observedAt??'Not read',item.pending])row.append(node('td',v));
    const cell=node('td');cell.append(button('Open',async()=>{entryId=item.id;render(await api(path()));}));row.append(cell);$('jobs').append(row);
  }
  $('page').textContent=total?String(offset+1)+'–'+Math.min(total,offset+50)+' of '+total:'No retained jobs';
}
function form(id,fn){$(id).onsubmit=event=>{event.preventDefault();run(fn);};}
form('search-form',async()=>{offset=0;await load();});
$('previous').onclick=()=>run(async()=>{offset=Math.max(0,offset-50);await load();});
$('next').onclick=()=>run(async()=>{offset+=50;await load();});
$('reload').onclick=()=>run(load);
$('refresh').onclick=()=>run(async()=>render(await api(path('refresh'),{})));
$('stop').onclick=async()=>{if(entryId)try{await api(path('stop'),{});say('The original request has stopped; its saved outcome is retained.');}catch(e){say(e.message);}};
async function ensureReceipt(){if(!current?.receipt)render(await api(path('refresh'),{}));}
form('issue-form',async()=>{await ensureReceipt();render(await api(path('issues'),{requestId:crypto.randomUUID(),
  expectedRevision:current.receipt.revision,message:$('issue-message').value,requestedRemedy:$('remedy').value}));$('issue-message').value='';});
form('message-form',async()=>{await ensureReceipt();render(await api(path('messages'),{requestId:crypto.randomUUID(),
  expectedRevision:current.receipt.revision,message:$('message').value}));$('message').value='';});
$('export').onclick=()=>run(async()=>{
  const response=await fetch(path('export'),{headers:{Authorization:'Bearer '+token}});
  if(!response.ok)throw new Error((await response.json()).error);
  const blob=await response.blob(),url=URL.createObjectURL(blob),a=node('a');a.href=url;a.download='paid-job-resolution.json';a.click();
  setTimeout(()=>URL.revokeObjectURL(url),1000);
});
form('receive-form',async()=>{
  const file=$('receive-file').files[0];if(!file||file.size>RESOLUTION_RECEIVING_BYTES)throw new Error('Choose a resolution file up to '+(RESOLUTION_RECEIVING_BYTES/1024/1024)+' MiB.');
  render(await api(path('receive'),JSON.parse(await file.text())));
});
run(load);
