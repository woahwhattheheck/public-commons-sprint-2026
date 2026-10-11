const get=id=>document.getElementById(id);
const EVIDENCE={
  delivery:['Delivery records','Tracking or delivery records you can inspect.'],
  refund:['Refund records','Records of an actual refund, if one exists.'],
  order_record:['Order record','The original order or transaction documentation.'],
  merchant_terms:['Merchant terms','The terms applicable to this order.'],
  buyer_messages:['Buyer communications','Relevant communications retained in your records.']
};
const CASE_FIELDS=['dispute_id','reason','status','stage','amount','currency','opened_at',
  'updated_at','disputed_transaction_count','source','provider_verified','payment_verified','evidence_submitted'];
let records=[],selection=null,packet=null,busy=false,aiConfigured=false,selectionStale=false;
let evidence=blankEvidence();
function blankEvidence(){return Object.fromEntries(Object.keys(EVIDENCE).map(key=>[key,false]));}
function node(tag,text,className){
  const element=document.createElement(tag);
  if(text!==undefined)element.textContent=String(text);
  if(className)element.className=className;
  return element;
}
function say(message){get('feedback').textContent=message;}
const readable=value=>String(value||'UNKNOWN').replaceAll('_',' ').toLowerCase();
const sourceLabel=entry=>entry.source==='SYNTHETIC_DEMO'?'Synthetic example · no provider data':
  entry.source==='PAYPAL_SANDBOX_API'?'Read-only PayPal sandbox data':String(entry.source||'Source unavailable');
function caseKey(entry){return JSON.stringify(CASE_FIELDS.map(field=>entry?.[field]??null));}
function evidenceKey(flags){return JSON.stringify(Object.keys(EVIDENCE).map(key=>flags?.[key]===true));}
function currentPacket(){
  return !!packet&&!!selection&&caseKey(packet.packet.case)===caseKey(selection)&&
    evidenceKey(packet.packet.flags)===evidenceKey(evidence);
}
function controls(){
  for(const id of ['load','demo','caseSearch','caseStatus'])get(id).disabled=busy;
  get('prepare').disabled=busy||!selection||selectionStale;
  get('refreshCase').disabled=busy||!selection;
  get('save').disabled=busy||!currentPacket();
  for(const input of get('checks').querySelectorAll('input'))input.disabled=busy||!selection;
  for(const button of get('cases').querySelectorAll('button'))button.disabled=busy;
}
function invalidateDraft(message='Prepare a packet for the selected case and current evidence choices.'){
  packet=null;
  get('report').hidden=true;
  get('draftEmpty').hidden=false;
  get('draftEmpty').textContent=message;
  get('rawPacket').textContent='';
  controls();
}
function facts(target,values){
  get(target).replaceChildren(...values.map(([label,value])=>{
    const row=node('div',undefined,'fact');
    row.append(node('dt',label),node('dd',value===null||value===undefined||value===''?'Not provided':value));
    return row;
  }));
}
function renderSelection(){
  get('detailEmpty').hidden=!!selection;
  get('detail').hidden=!selection;
  if(selection){
    get('caseHeading').textContent=selection.dispute_id;
    get('caseSource').textContent=sourceLabel(selection)+(selectionStale?' · refresh needed':'');
    facts('caseFacts',[
      ['Reason',readable(selection.reason)],['Status',readable(selection.status)],
      ['Stage',readable(selection.stage)],
      ['Disputed amount',selection.amount!==null&&selection.currency?`${selection.currency} ${selection.amount}`:'Not provided'],
      ['Opened',selection.opened_at],['Source updated',selection.updated_at],
      ['Disputed transaction count',selection.disputed_transaction_count]
    ]);
  }
  renderChecks();renderCases();controls();
}
function renderChecks(){
  get('checks').replaceChildren(...Object.entries(EVIDENCE).map(([key,[label,hint]])=>{
    const wrap=node('label',undefined,'check'),input=node('input');
    input.type='checkbox';input.dataset.key=key;input.checked=evidence[key];
    input.disabled=busy||!selection;
    const copy=node('span',undefined,'check-copy');
    copy.append(node('span',label,'check-label'),node('span',hint,'check-hint'));
    wrap.append(input,copy);
    input.addEventListener('change',()=>{
      if(busy){input.checked=evidence[key];return;}
      evidence[key]=input.checked;
      invalidateDraft('Evidence choices changed. Prepare a new packet before downloading.');
      renderEvidenceStatus();
    });
    return wrap;
  }));
  renderEvidenceStatus();
}
function renderEvidenceStatus(){
  const count=Object.values(evidence).filter(Boolean).length;
  get('evidenceStatus').textContent=selection
    ?`${count} of 5 categories marked available by you. These choices do not verify documents.`
    :'Select a case before marking the records you can substantiate.';
}
function renderCases(){
  const query=get('caseSearch').value.trim().toLowerCase(),status=get('caseStatus').value;
  const visible=records.filter(entry=>(status==='all'||entry.status===status)&&
    [entry.dispute_id,entry.reason,entry.status,entry.stage].some(value=>String(value||'').toLowerCase().includes(query)));
  get('caseCount').textContent=`${visible.length} of ${records.length} loaded case${records.length===1?'':'s'}`;
  get('cases').replaceChildren(...visible.map(entry=>{
    const button=node('button',undefined,'case-card'+(selection?.dispute_id===entry.dispute_id?' selected':''));
    button.type='button';button.disabled=busy;
    button.setAttribute('aria-pressed',String(selection?.dispute_id===entry.dispute_id));
    button.append(node('span',entry.dispute_id,'case-title'),
      node('span',`${readable(entry.status)} · ${readable(entry.reason)}`,'case-meta'),
      node('span',sourceLabel(entry),'case-source'));
    button.addEventListener('click',()=>selectCase(entry));
    return button;
  }));
  if(!visible.length)get('cases').append(node('p',records.length?'No loaded cases match these filters.':'Load a case source to begin.','empty-state'));
}
function updateStatusFilter(){
  const previous=get('caseStatus').value;
  const statuses=[...new Set(records.map(entry=>entry.status))].sort();
  const options=[node('option','All statuses'),...statuses.map(status=>{
    const option=node('option',readable(status));option.value=status;return option;
  })];
  options[0].value='all';get('caseStatus').replaceChildren(...options);
  get('caseStatus').value=statuses.includes(previous)?previous:'all';
}
async function api(url,body){
  const response=await fetch(url,body===undefined?{}:{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
  let data;
  try{data=await response.json();}catch{throw new Error('The response could not be read. Retry manually when ready.');}
  if(!response.ok)throw new Error(data.error||`Request failed (HTTP ${response.status})`);
  return data;
}
async function loadCases(url){
  if(busy)return;
  busy=true;records=[];selection=null;selectionStale=false;evidence=blankEvidence();
  invalidateDraft('Load and select a case to prepare a review packet.');
  updateStatusFilter();renderSelection();
  get('coverage').textContent='Reading the selected source…';say('Reading cases…');
  try{
    const data=await api(url);
    const incoming=Array.isArray(data.cases)?data.cases:data.case?[data.case]:null;
    if(!incoming)throw new Error('The case response did not contain a case list.');
    records=incoming;
    updateStatusFilter();renderCases();
    get('coverage').textContent=data.synthetic
      ?'One original synthetic example. No PayPal request was made.'
      :`${records.length} sandbox case(s) across ${data.pages_read} page(s). ${data.incomplete
        ?'PARTIAL: the 80-case review limit was reached; this is not the full merchant portfolio.'
        :'All cases returned by this bounded list read are shown.'}`;
    say(records.length?'Choose a case to inspect its source facts.':'No cases were returned.');
  }catch(error){get('coverage').textContent='No case list loaded.';say(error.message);}
  finally{busy=false;controls();}
}
async function selectCase(entry,refresh=false){
  if(busy)return;
  busy=true;selection=null;selectionStale=false;evidence=blankEvidence();
  invalidateDraft('Case selection changed. Review its facts and mark only evidence you can substantiate.');
  renderSelection();say('Loading the selected case…');
  try{
    const detail=entry.source==='PAYPAL_SANDBOX_API'
      ?(await api('/api/detail?id='+encodeURIComponent(entry.dispute_id))).case
      :refresh?(await api('/api/demo')).case:entry;
    if(!detail||detail.dispute_id!==entry.dispute_id||detail.source!==entry.source)
      throw new Error('The returned case did not match the selection. Load the case list again.');
    selection=detail;
    records=records.map(record=>record.dispute_id===detail.dispute_id?detail:record);
    updateStatusFilter();renderSelection();
    say(`${sourceLabel(detail)}. Evidence choices start unchecked.`);
    get('caseHeading').focus();
  }catch(error){say(error.message);}
  finally{busy=false;controls();}
}
function categoryList(id,categories,empty){
  get(id).replaceChildren(...categories.map(key=>node('li',EVIDENCE[key]?.[0]||key,'evidence-item')));
  if(!categories.length)get(id).append(node('li',empty,'empty-state'));
}
function renderPacket(){
  const draft=packet.packet,advisory=packet.advisory;
  get('draftEmpty').hidden=true;get('report').hidden=false;
  get('draftStatus').textContent=`Draft prepared for ${draft.case.dispute_id} · current evidence choices`;
  facts('packetMeta',[['Review state',draft.review_status],['Prepared',draft.created_at],['Source',sourceLabel(draft.case)],
    ['Evidence submissions',draft.submissions_performed],['Refund actions',draft.refund_actions_performed]]);
  categoryList('availableEvidence',draft.marked_available,'No relevant evidence categories are marked available.');
  categoryList('missingEvidence',draft.needs_human_evidence,'No categories are missing from this checklist. Documents and submission requirements still need human verification.');
  get('packetNotice').textContent=draft.notice;
  get('advisoryStatus').textContent=advisory.model_used?'Optional AI advisory · separate from case facts':'Offline checklist · no model output';
  get('advisorySummary').textContent=advisory.summary;
  get('advisoryQuestions').replaceChildren(...advisory.questions.map(question=>node('li',question)));
  get('rawPacket').textContent=JSON.stringify(packet,null,2);
}
get('load').addEventListener('click',()=>loadCases('/api/disputes'));
get('demo').addEventListener('click',()=>loadCases('/api/demo'));
get('caseSearch').addEventListener('input',renderCases);
get('caseStatus').addEventListener('change',renderCases);
get('refreshCase').addEventListener('click',()=>{if(selection&&!busy)void selectCase(selection,true);});
get('prepare').addEventListener('click',async()=>{
  if(busy||!selection||selectionStale)return;
  const selectedKey=caseKey(selection),selectedId=selection.dispute_id;
  const selectedEvidence={...evidence},selectedEvidenceKey=evidenceKey(selectedEvidence);
  busy=true;invalidateDraft('Preparing a packet for this case and these evidence choices…');controls();
  say(aiConfigured?'Preparing the checklist and requesting the configured optional AI advisory…':'Preparing the offline evidence checklist…');
  try{
    const data=await api('/api/packet',{id:selectedId,evidence:selectedEvidence});
    if(caseKey(data.packet?.case)!==selectedKey||data.packet?.source!==selection.source||
       evidenceKey(data.packet?.flags)!==selectedEvidenceKey||caseKey(selection)!==selectedKey||evidenceKey(evidence)!==selectedEvidenceKey){
      selectionStale=true;
      throw new Error('The case facts or evidence choices changed. Refresh the selected case and review it before preparing another packet.');
    }
    if(!Array.isArray(data.packet.marked_available)||!Array.isArray(data.packet.needs_human_evidence)||
       !data.advisory||!Array.isArray(data.advisory.questions))throw new Error('The draft response was incomplete. No packet is available to download.');
    packet=data;renderPacket();say('Draft ready for human review. Nothing was filed, changed or refunded.');
  }catch(error){
    if(error.message==='Review expired. Fetch the dispute again.')selectionStale=true;
    invalidateDraft(selectionStale?'Refresh the selected case before preparing another packet.':'No current packet is available. Review the case and retry explicitly when ready.');
    if(selectionStale)renderSelection();
    say(error.message);
  }
  finally{busy=false;controls();}
});
get('save').addEventListener('click',()=>{
  if(busy||!currentPacket())return;
  const bytes=new Blob([JSON.stringify(packet,null,2)+'\n'],{type:'application/json'});
  const url=URL.createObjectURL(bytes),link=node('a');
  link.href=url;link.download='disputeledger-'+packet.packet.case.dispute_id+'.json';
  document.body.append(link);link.click();link.remove();
  setTimeout(()=>URL.revokeObjectURL(url),1000);
  say('Downloaded this case’s current draft and evidence choices. No PayPal submission occurred.');
});
api('/api/health').then(status=>{
  aiConfigured=status.ai_configured===true;
  get('health').textContent=`PayPal sandbox: ${status.paypal_sandbox_configured?'configured':'not configured'} · Optional AI: ${aiConfigured?'configured; requested when you prepare a packet':'offline checklist only'}`;
}).catch(()=>{get('health').textContent='Backend unavailable. Start the local server and reload.';});
updateStatusFilter();renderSelection();invalidateDraft('Load and select a case to prepare a review packet.');
