// MIT. Plain operator controls over the original merchant resolution API.
const $=id=>document.getElementById(id),sessionKey='sf.jobs.resolution.operator';
let token=location.hash.slice(1)||sessionStorage.getItem(sessionKey)||'',selected=null,busy=false;
if(/^[a-f0-9]{64}$/.test(token)){sessionStorage.setItem(sessionKey,token);history.replaceState(null,'',location.pathname);}
$('jobs-link').href='/#'+token;
$('effective-at').value=new Date().toISOString();
const say=message=>{$('notice').textContent=message;};
const node=(tag,value,className)=>{const e=document.createElement(tag);if(value!==undefined)e.textContent=String(value);if(className)e.className=className;return e;};
const button=(label,fn)=>{const e=node('button',label);e.type='button';e.addEventListener('click',()=>run(fn));return e;};
async function api(path,value){
  const response=await fetch(path,{method:value===undefined?'GET':'POST',headers:{Authorization:'Bearer '+token,
    ...(value===undefined?{}:{'Content-Type':'application/json'})},...(value===undefined?{}:{body:JSON.stringify(value)})});
  const data=await response.json();if(!response.ok)throw new Error(data.error??'Request failed');return data;
}
async function run(fn){
  if(busy)return;busy=true;say('Working…');for(const b of document.querySelectorAll('button'))b.disabled=true;
  try{await fn();say('Saved.');}catch(e){say(e.message.replaceAll('_',' '));}
  finally{busy=false;for(const b of document.querySelectorAll('button'))b.disabled=false;}
}
const path=action=>'/api/jobs/'+encodeURIComponent(selected.case.job.jobId)+'/resolution'+(action?'/'+action:'');
async function action(name,input){render(await api(path(name),input));}
function render(value){
  selected=value;$('case').hidden=false;
  const c=value.case,j=value.job;
  $('job-title').textContent=c.job.jobId;
  $('job-state').textContent='Execution '+j.state+' · job revision '+j.revision+' · case '+c.state+' · case revision '+c.revision;
  $('payment').textContent=c.job.payment.amountAtomic+' atomic units · '+c.job.payment.network+'\n'+c.job.payment.asset;
  $('binding').textContent=JSON.stringify({settlement:c.job.settlement,accounting:c.accounting?.source??null},null,2);
  $('customer-receipt').textContent=JSON.stringify(value.customer,null,2);
  $('totals').replaceChildren();
  const t=c.accounting?.detail.totals;
  if(t)for(const [name,key] of [['Original amount','grossAmountAtomic'],['Returned','refundedAmountAtomic'],['Pending refund','pendingRefundAmountAtomic'],
    ['Remaining','remainingAmountAtomic'],['Recorded cancellation','cancelledAmountAtomic']]){
    const e=node('div',undefined,'number');e.append(node('strong',t[key]),node('span',name));$('totals').append(e);
  }
  $('run-id').value=c.accounting?.source.runId??'';
  $('bind-form').hidden=Boolean(c.accounting);
  $('conversation').replaceChildren();
  const conversation=[...c.issues.map(i=>({at:i.createdAt,author:'Customer · '+i.requestedRemedy,message:i.message,id:i.id})),
    ...c.messages.map(m=>({at:m.at,author:m.author,message:m.text,id:m.id}))].sort((a,b)=>a.at.localeCompare(b.at));
  if(!conversation.length)$('conversation').append(node('p','No customer issue is retained.'));
  for(const m of conversation){const e=node('div',undefined,'entry');e.append(node('strong',m.author),node('small',' · '+m.at),node('p',m.message));$('conversation').append(e);}
  $('decisions').replaceChildren();
  for(const d of c.decisions){const e=node('div',undefined,'entry');e.append(node('strong',d.kind+' · '+d.state),node('p',d.message));$('decisions').append(e);}
  $('previews').replaceChildren();
  for(const p of [...c.previews].reverse()){
    const e=node('div',undefined,'entry'),r=p.preview.request;
    e.append(node('strong',r.kind+' · '+r.amountAtomic+' atomic units'),node('p',r.reason),
      node('small','Effective '+r.effectiveAt+' · '+r.id));
    const details=node('details');details.append(node('summary','Reviewed payment and return terms'),node('pre',JSON.stringify({
      original:p.preview.detail.event,returnTerms:p.preview.detail.refundTerms,source:p.preview.detail.source,
      accountingRevision:p.preview.workspaceRevision,previewSha256:p.preview.previewSha256},null,2)));e.append(details);
    const op=c.operations.find(o=>o.id===p.id);
    if(!op)e.append(button('Record this reviewed adjustment',()=>action('record',{requestId:p.id,expectedRevision:selected.case.revision})));
    else e.append(node('p','Original request '+op.state));
    $('previews').append(e);
  }
  $('adjustments').replaceChildren();$('refund-id').replaceChildren();
  for(const r of c.accounting?.detail.adjustments??[]){
    const e=node('div',undefined,'entry');e.append(node('strong',r.kind+' · '+r.status+' · '+r.amountAtomic),
      node('p',r.reason),node('code',r.id+(r.verification?.transaction?'\n'+r.verification.transaction:'')));$('adjustments').append(e);
    if(r.kind==='REFUND'&&!['VERIFIED','WITHDRAWN'].includes(r.status)){
      const option=node('option',r.amountAtomic+' · '+r.status+' · '+r.id);option.value=r.id;$('refund-id').append(option);
    }
  }
  $('operations').replaceChildren();
  for(const op of [...c.operations].reverse()){
    const e=node('div',undefined,'entry');e.append(node('strong',op.kind+' · '+op.state),node('p',op.id));
    if(op.nativeJob)e.append(node('p','Original verification '+op.nativeJob.id+' · '+op.nativeJob.status));
    if(op.error)e.append(node('p',op.error.code.replaceAll('_',' ')));
    if(op.state!=='RECORDED'){
      e.append(button('Recover original outcome',()=>action('recover',{requestId:op.id})),
        button('Resume saved request',()=>action('resume',{requestId:op.id,expectedRevision:selected.case.revision})));
    }
    $('operations').append(e);
  }
}
async function load(){
  const data=await api('/api/resolutions');
  $('jobs').replaceChildren();$('connection').textContent=data.connection.connected?
    'Connected to '+(data.connection.origin??'the original in-process accounting owner'):'Choose the running original accounting workspace.';
  if(data.connection.origin)$('accounting-url').value=data.connection.origin;
  for(const item of data.items){
    const row=node('tr');
    for(const v of [item.label||item.job.id,item.job.state,item.state,item.issueCount,item.totals?.refundedAmountAtomic??'—',
      item.totals?.remainingAmountAtomic??'—'])row.append(node('td',v));
    const cell=node('td');cell.append(button('Open',async()=>render(await api('/api/jobs/'+encodeURIComponent(item.job.id)+'/resolution'))));row.append(cell);$('jobs').append(row);
  }
  if(!data.items.length){const row=node('tr'),cell=node('td','Paid application jobs appear here after the original native settlement.');cell.colSpan=7;row.append(cell);$('jobs').append(row);}
}
function form(id,fn){$(id).addEventListener('submit',event=>{event.preventDefault();run(fn);});}
$('reload').onclick=()=>run(load);
form('connect-form',async()=>{await api('/api/resolutions/connection',{url:$('accounting-url').value});await load();});
$('load-runs').onclick=()=>run(async()=>{
  const state=await api('/api/resolutions/accounting');$('run-select').replaceChildren(node('option','Choose original run'));
  for(const r of state.runs){const e=node('option',(r.label??r.status??r.state??'Run')+' · '+r.id);e.value=r.id;$('run-select').append(e);}
});
$('run-select').onchange=()=>{$('run-id').value=$('run-select').value;};
form('bind-form',()=>action('bind',{runId:$('run-id').value.trim(),expectedRevision:selected.case.revision}));
form('reply-form',async()=>{await action('reply',{requestId:crypto.randomUUID(),expectedRevision:selected.case.revision,message:$('reply').value});$('reply').value='';});
form('decision-form',async()=>{
  const kind=$('decision-kind').value,input={requestId:crypto.randomUUID(),expectedRevision:selected.case.revision,
    actor:$('actor').value,message:$('decision-message').value};
  if(['CLOSE_CASE','REOPEN_CASE'].includes(kind))await action('case',{...input,state:kind==='CLOSE_CASE'?'CLOSED':'OPEN'});
  else await action('job',{...input,kind,expectedJobRevision:selected.job.revision});
});
form('preview-form',()=>action('preview',{requestId:crypto.randomUUID(),expectedRevision:selected.case.revision,kind:$('kind').value,
  amountAtomic:$('amount').value.trim(),effectiveAt:$('effective-at').value.trim(),reason:$('reason').value,
  reference:$('reference').value,actor:$('actor').value}));
form('verify-form',()=>action('verify',{requestId:crypto.randomUUID(),expectedRevision:selected.case.revision,
  adjustmentId:$('refund-id').value,transaction:$('transaction').value.trim(),actor:$('actor').value}));
form('withdraw-form',()=>action('withdraw',{requestId:crypto.randomUUID(),expectedRevision:selected.case.revision,
  adjustmentId:$('refund-id').value,reason:$('withdraw-reason').value,actor:$('actor').value}));
$('refresh-case').onclick=()=>run(()=>selected.case.accounting?action('refresh',{}):api(path()).then(render));
async function download(action,name){
  const response=await fetch(path(action),{headers:{Authorization:'Bearer '+token}});
  if(!response.ok)throw new Error((await response.json()).error);
  const blob=await response.blob(),url=URL.createObjectURL(blob),a=node('a');a.href=url;a.download=name;a.click();
  setTimeout(()=>URL.revokeObjectURL(url),1000);
}
$('export').onclick=()=>run(()=>download('export','job-resolution-private.json'));
$('accounting-export').onclick=()=>run(()=>download('accountingexport','merchant-adjustments.json'));
run(load);
