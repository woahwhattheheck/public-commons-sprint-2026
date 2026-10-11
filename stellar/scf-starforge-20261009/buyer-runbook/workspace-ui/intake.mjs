// MIT. Presentation for native private-request review and local preparation.
import {paymentOptionsTable} from './clients.mjs';
const $=selector=>document.querySelector(selector);
const escape=value=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
const when=value=>new Date(value).toLocaleString();
const readable=value=>String(value??'').toLowerCase().replaceAll('_',' ');
const title=item=>(item.summary.method??'POST')+' '+new URL(item.summary.url).pathname;

export function createHandoffIntakeUI({request,notice,openPanel,onPrepared,refreshState}) {
  let state={requests:[]},selected=null,busy=false,generation=0,reviewChanged=false;
  function disabled() {
    const form=$('#request-review-form');
    for(const element of form.elements)element.disabled=busy||!state.operator||Boolean(selected?.prepared)||Boolean(selected?.expired);
    $('#upload-request').disabled=busy;
    $('#prepare-request').disabled=busy||reviewChanged||!selected?.review||Boolean(selected?.prepared)||Boolean(selected?.expired)||!state.operator;
    $('#add-request-to-plan').disabled=busy||!selected?.prepared;
  }
  function renderList() {
    $('#request-size-limit').textContent=Number.isSafeInteger(state.maxHandoffBytes)?'Complete packet limit: '+state.maxHandoffBytes.toLocaleString()+' bytes.':'';
    $('#request-count').textContent=String(state.requests.length);
    $('#received-request-list').innerHTML=state.requests.length?state.requests.map(item=>
      `<button class="request-row ${item.id===selected?.id?'selected':''}" data-request="${item.id}"><span><strong>${escape(title(item))}</strong><small>${escape(item.summary.url)}</small></span><span class="badge">${item.prepared?'Ready':item.summary.expiresAt!=null&&item.summary.expiresAt<=Date.now()?'Expired':'Needs review'}</span></button>`).join(''):
      '<p class="muted">Uploaded merchant requests are retained here for review and reopening.</p>';
    const op=state.operator;
    $('#request-operator').innerHTML=op?
      `<strong>Local buyer · ${escape(op.actor)} / ${escape(op.service)}</strong><p class="wrap">Payer <code>${escape(op.payer)}</code></p><p class="muted">Maximum per prepared request: ${escape(op.maxTotalAtomic)} total atomic · ${escape(op.maxDailyAtomic)} per UTC day. ${op.signerSource==='ENVIRONMENT'?'Wallet key environment: '+escape(op.walletKeyEnvironment)+'.':'Uses the locally declared signer provider.'}</p>`:
      `<strong>Local operator settings ${state.presetError?'need attention':'required for preparation'}</strong><p>${state.presetError?escape(readable(state.presetError))+'.':'Start this workspace with --operator-settings pointing to your private buyer settings file. Uploaded requests remain available here.'}</p>`;
    $('#request-errors').textContent=state.errors?.length?state.errors.map(item=>readable(item.code)).join('; '):'';
  }
  function renderSelected() {
    const area=$('#request-detail');area.hidden=!selected;
    if(!selected){disabled();return;}
    const item=selected,view=item.view,review=item.review;
    $('#request-filename').textContent=title(item);
    $('#request-state').textContent=item.prepared?'Ready to add':item.expired?'Ticket expired':review?'Reviewed':'Select payment option';
    $('#request-url').textContent=view.method+' '+view.sellerUrl;
    $('#request-summary').innerHTML=`<div><dt>Stable intent</dt><dd>${escape(view.intentId)}</dd></div><div><dt>Operation ticket / expiry</dt><dd>${escape(view.operationTicket?when(view.operationTicket.expiresAt):'No operation ticket')}</dd></div><div><dt>Exact request body</dt><dd>${view.bodyPresent===false?'Omitted as declared by the source':view.bodyBytes.toLocaleString()+' bytes'}</dd></div><div><dt>Forwarded request headers</dt><dd>${view.requestHeaderNames.length}</dd></div>`;
    $('#request-body-download').href=`/files/requests/${item.id}/body`;
    $('#request-body-download').hidden=view.bodyPresent===false;
    $('#request-handoff-download').href=`/files/requests/${item.id}/handoff`;
    $('#request-bytes').innerHTML=`<p>Original private file</p><code>${escape(item.filename)}</code><p>Body SHA-256</p><code>${escape(view.bodySha256)}</code><p>Merchant operation key</p><code>${escape(view.operationTicket?.operationKey??'Not part of this request')}</code><p>Request headers</p><pre>${escape(JSON.stringify(view.requestHeaders,null,2))}</pre>`;
    $('#request-option').innerHTML='<option value="">Choose a payment option</option>'+view.choices.map(choice=>choice.error?
      `<option disabled>Option ${choice.acceptIndex+1} · ${escape(readable(choice.error))}</option>`:
      `<option value="${choice.acceptIndex}" ${review?.acceptIndex===choice.acceptIndex?'selected':''}>Option ${choice.acceptIndex+1} · ${escape(choice.acceptedTerms.maxAtomic)} atomic · ${escape(choice.acceptedTerms.network)} · ${escape(choice.acceptedTerms.asset)}</option>`).join('');
    $('#request-option-terms').innerHTML=paymentOptionsTable(view.choices.map(choice=>({
      index:choice.acceptIndex,terms:choice.offeredTerms??choice.acceptedTerms,error:choice.error})));
    $('#request-total').value=review?.totalAtomic??'';
    $('#request-daily').value=review?.dailyAtomic??'';
    $('#request-payment-review').hidden=!review;
    $('#request-payment-review').innerHTML=review?`<h3>Reviewed local purchase settings</h3><dl class="detail-grid"><div><dt>Recipient</dt><dd><code>${escape(review.acceptedTerms.payTo)}</code></dd></div><div><dt>Network</dt><dd>${escape(review.acceptedTerms.network)}</dd></div><div><dt>Exact asset</dt><dd><code>${escape(review.acceptedTerms.asset)}</code></dd></div><div><dt>Request ceiling</dt><dd>${escape(review.acceptedTerms.maxAtomic)} atomic</dd></div><div><dt>Total / daily budget</dt><dd>${escape(review.totalAtomic)} / ${escape(review.dailyAtomic)} atomic</dd></div><div><dt>Local payer</dt><dd><code>${escape(review.operator.payer)}</code></dd></div></dl><p class="muted">Revision ${review.revision} · ${escape(when(review.reviewedAt))}</p>`:'';
    $('#request-review-changed').hidden=true;
    $('#prepared-request').hidden=!item.prepared;
    $('#prepared-request-name').textContent=item.prepared?.configName??'';
    $('#request-expired').hidden=!item.expired;
    reviewChanged=false;disabled();renderList();
  }
  async function open(id) {
    const current=++generation;openPanel();notice('');
    const value=await request('/api/requests/'+id);
    if(current!==generation)return;
    selected=value;renderSelected();
  }
  async function action(fn) {
    if(busy)return;busy=true;disabled();notice('');
    try{await fn();}catch(error){notice(error.message,true);}
    finally{busy=false;disabled();}
  }
  $('#open-requests').addEventListener('click',()=>{openPanel();renderList();});
  $('#welcome-requests').addEventListener('click',()=>{openPanel();renderList();});
  $('#received-request-list').addEventListener('click',event=>{
    const target=event.target.closest('[data-request]');
    if(target&&!busy)open(target.dataset.request).catch(error=>notice(error.message,true));
  });
  $('#request-upload-form').addEventListener('submit',event=>{event.preventDefault();action(async()=>{
    const file=$('#request-upload').files[0];
    if(!file)throw new Error('Choose the private merchant request file.');
    const limit=state.maxHandoffBytes;
    if(!Number.isSafeInteger(limit)||limit<=0)throw new Error('Refresh the receiving workspace before uploading.');
    if(file.size===0||file.size>limit)throw new Error('Choose a complete merchant request of up to '+limit.toLocaleString()+' bytes.');
    const bytes=new Uint8Array(await file.arrayBuffer());let binary='';
    for(let offset=0;offset<bytes.length;offset+=16384)binary+=String.fromCharCode(...bytes.subarray(offset,offset+16384));
    const value=await request('/api/requests/upload',{filename:file.name,base64:btoa(binary)});
    selected=value;generation++;await refreshState();renderSelected();$('#request-upload').value='';
    notice(value.prepared?'This exact request is already prepared. Add its existing configuration to a plan.':'Request retained. Choose the payment option and local budget below.');
    $('#request-detail').scrollIntoView({block:'start'});
  });});
  $('#request-review-form').addEventListener('input',()=>{
    reviewChanged=true;$('#request-review-changed').hidden=!selected?.review;disabled();
  });
  $('#request-option').addEventListener('change',()=>{
    const chosen=selected?.view.choices.find(choice=>String(choice.acceptIndex)===$('#request-option').value);
    if(chosen?.acceptedTerms){
      for(const id of ['request-total','request-daily'])if(!$('#'+id).value)$('#'+id).value=chosen.acceptedTerms.maxAtomic;
    }
  });
  $('#request-review-form').addEventListener('submit',event=>{event.preventDefault();action(async()=>{
    if(!selected||$('#request-option').value==='')throw new Error('Choose a payment option before review.');
    selected=await request('/api/requests/review',{id:selected.id,acceptIndex:Number($('#request-option').value),
      totalAtomic:$('#request-total').value,dailyAtomic:$('#request-daily').value});
    renderSelected();notice('Review saved. Prepare the local buyer to add this request to an acquisition plan.');
  });});
  $('#prepare-request').addEventListener('click',()=>action(async()=>{
    if(!selected?.review||reviewChanged)throw new Error('Save the current request review first.');
    notice('Preparing the local buyer and its retained spending ledger…');
    await request('/api/requests/prepare',{id:selected.id,reviewSha256:selected.review.reviewSha256});
    selected=await request('/api/requests/'+selected.id);await refreshState();renderSelected();
    notice('Local buyer prepared. Add its configuration to an acquisition plan.');
  }));
  $('#add-request-to-plan').addEventListener('click',()=>action(async()=>{
    if(!selected?.prepared)throw new Error('Prepare this local buyer first.');
    await onPrepared(selected.prepared,selected);
  }));
  return {open,update(value){state=value??{requests:[]};renderList();disabled();},
    async refresh(){if(selected)await open(selected.id);else renderList();}};
}
