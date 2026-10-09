const el = id => document.getElementById(id);
let current = null;
async function request(path,init) {
  const response = await fetch(path,{cache:'no-store',...init});
  const data = await response.json();
  if (!response.ok) throw Error(data.error || ('HTTP ' + response.status));
  return data;
}
function error(message) { el('error').textContent = message || ''; }
function reset() {
  current=null;el('draft').disabled=true;el('facts').textContent='Select a subscription.';
  el('proposal').textContent='No draft requested.';
}
async function openItem(id,mode) {
  try {
    error('');el('label').textContent='Reading current provider state…';
    const data = await request('/api/detail?mode=' + mode + '&id=' + encodeURIComponent(id));
    // Reject stale UI responses if mode has changed during the request.
    if (el('mode').value !== mode) return;
    current={mode,id,fingerprint:data.receipt.fingerprint};
    el('facts').textContent=JSON.stringify(data.receipt,null,2);
    el('draft').disabled=false;
    el('proposal').textContent='No draft requested.';
  } catch(e) { error(e.message); reset(); }
  finally { el('label').textContent=''; }
}
el('mode').addEventListener('change',()=>{reset();el('list').replaceChildren();error('');});
el('load').addEventListener('click',async()=>{
  const mode=el('mode').value;reset();error('');el('label').textContent='Loading…';
  el('load').disabled=true;
  try {
    const data=await request('/api/list?mode=' + mode);
    if(el('mode').value!==mode)return;
    const list=el('list');list.replaceChildren();
    if(!data.items.length){list.textContent='No subscriptions were returned.';return;}
    for(const item of data.items) {
      const li=document.createElement('li'),button=document.createElement('button');
      button.textContent=item.id+' — '+item.status+' ('+item.plan_id+')';
      button.addEventListener('click',()=>openItem(item.id,mode));
      li.append(button);list.append(li);
    }
  }catch(e){error(e.message);}finally{el('load').disabled=false;el('label').textContent='';}
});
el('draft').addEventListener('click',async()=>{
  if(!current)return;
  const selected={...current};el('draft').disabled=true;error('');
  el('proposal').textContent='Preparing an unsent review draft…';
  try {
    const response=await request('/api/draft',{method:'POST',
      headers:{'Content-Type':'application/json'},body:JSON.stringify(selected)});
    if(!current || response.receipt.fingerprint!==current.fingerprint || el('mode').value!==current.mode)return;
    el('proposal').textContent=response.proposal.kind+':\n'+response.proposal.text+'\n\nSent: NO. Subscription modified: NO.';
  }catch(e){error(e.message);el('proposal').textContent='No draft; refresh subscription facts.';}
  finally{el('draft').disabled=!current;}
});
