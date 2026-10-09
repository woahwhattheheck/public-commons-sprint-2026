const el = id => document.getElementById(id);
let current = null;
async function request(path,init) {
  const response = await fetch(path,{cache:'no-store',...init});
  const data = await response.json();
  if (!response.ok) throw Error(data.error || ('HTTP ' + response.status));
  return data;
}
function error(message) { el('error').textContent = message || ''; }
// A same-mode selection can race a previous detail request. Only the most
// recent selection/list/draft response may change that part of the view.
let detailSeq=0, listSeq=0, draftSeq=0, statusSeq=0;
function status(message) { el('label').textContent=message;return ++statusSeq; }
function clearStatus(token) { if(token===statusSeq)el('label').textContent=''; }
function reset() {
  detailSeq++;draftSeq++;statusSeq++;
  current=null;el('draft').disabled=true;el('facts').textContent='Select a subscription.';
  el('proposal').textContent='No draft requested.';el('label').textContent='';
}
async function openItem(id,mode) {
  const token=++detailSeq;
  draftSeq++;current=null;el('draft').disabled=true;
  el('proposal').textContent='No draft requested.';
  error('');const label= status('Reading current provider state…');
  try {
    const data = await request('/api/detail?mode=' + mode + '&id=' + encodeURIComponent(id));
    if (token!==detailSeq || el('mode').value!==mode) return;
    current={mode,id,fingerprint:data.receipt.fingerprint};
    el('facts').textContent=JSON.stringify(data.receipt,null,2);
    el('draft').disabled=false;
  } catch(e) {
    if (token!==detailSeq || el('mode').value!==mode) return;
    error(e.message);reset();
  } finally { clearStatus(label); }
}
el('mode').addEventListener('change',()=>{
  listSeq++;reset();el('list').replaceChildren();el('load').disabled=false;error('');
});
el('load').addEventListener('click',async()=>{
  const token=++listSeq, mode=el('mode').value;
  reset();error('');const label=status('Loading…');
  el('load').disabled=true;
  try {
    const data=await request('/api/list?mode=' + mode);
    if(token!==listSeq || el('mode').value!==mode)return;
    const list=el('list');list.replaceChildren();
    if(!data.items.length){list.textContent='No subscriptions were returned.';return;}
    for(const item of data.items) {
      const li=document.createElement('li'),button=document.createElement('button');
      button.textContent=item.id+' — '+item.status+' ('+item.plan_id+')';
      button.addEventListener('click',()=>openItem(item.id,mode));
      li.append(button);list.append(li);
    }
  }catch(e){
    if(token===listSeq && el('mode').value===mode)error(e.message);
  }finally{
    if(token===listSeq)el('load').disabled=false;
    clearStatus(label);
  }
});
el('draft').addEventListener('click',async()=>{
  if(!current)return;
  const selected={...current},token=++draftSeq;
  el('draft').disabled=true;error('');
  el('proposal').textContent='Preparing an unsent review draft…';
  const selectedStillCurrent=()=>token===draftSeq && current &&
    current.mode===selected.mode && current.id===selected.id &&
    current.fingerprint===selected.fingerprint && el('mode').value===selected.mode;
  try {
    const response=await request('/api/draft',{method:'POST',
      headers:{'Content-Type':'application/json'},body:JSON.stringify(selected)});
    if(!selectedStillCurrent() || response.receipt.fingerprint!==selected.fingerprint)return;
    el('proposal').textContent=response.proposal.kind+':\n'+response.proposal.text+'\n\nSent: NO. Subscription modified: NO.';
  }catch(e){
    if(selectedStillCurrent()){
      error(e.message);el('proposal').textContent='No draft; refresh subscription facts.';
    }
  }finally{if(token===draftSeq)el('draft').disabled=!current;}
});
