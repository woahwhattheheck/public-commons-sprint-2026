// MIT. Paid-file receiving and original transfer controls in the buyer runbook.
const $ = selector => document.querySelector(selector);
const escape = value => String(value ?? '').replace(/[&<>"']/g, char =>
  ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
const readable = value => String(value ?? '—').toLowerCase().replaceAll('_', ' ');
const bytes = value => Number.isSafeInteger(value) ? value.toLocaleString() + ' bytes' : '—';

export function createPaidFileUI({request, notice, refreshState, openPanel, onPrepared, current, action}) {
  let state = {requests:[],claimEnvs:[]}, selected = null, busy = false, changed = false, generation = 0;
  function controls() {
    for(const element of $('#file-review-form').elements)
      element.disabled=busy||!state.operator||Boolean(selected?.prepared)||Boolean(selected?.preparing);
    $('#upload-file-order').disabled=busy;
    $('#prepare-file-order').disabled=busy||changed||!selected?.review||Boolean(selected?.prepared)||!state.operator;
    $('#add-file-to-plan').disabled=busy||!selected?.prepared;
  }
  function list() {
    $('#file-order-count').textContent=String(state.requests.length);
    $('#file-order-list').innerHTML=state.requests.length?state.requests.map(item=>
      `<button class="request-row ${selected?.id===item.id?'selected':''}" data-file-order="${escape(item.id)}"><span><strong>${escape(item.summary.orderReference)}</strong><small>${escape(item.summary.url)}</small></span><span class="badge">${item.prepared?'Ready':bytes(item.summary.bytes)}</span></button>`).join(''):
      '<p class="muted">Received file orders appear here. Reopening an order keeps its original buyer and download.</p>';
    const operator=state.operator;
    $('#file-operator').innerHTML=operator?`<strong>Local buyer · ${escape(operator.actor)} / ${escape(operator.service)}</strong><p class="wrap">Payer <code>${escape(operator.payer)}</code></p><p class="muted">Maximum per prepared order: ${escape(operator.maxTotalAtomic)} total atomic · ${escape(operator.maxDailyAtomic)} per UTC day.</p>`:
      `<strong>Local operator settings required for preparation</strong><p>${state.presetError?escape(readable(state.presetError)): 'Start with --operator-settings pointing to your existing private buyer preset.'}</p>`;
    $('#file-order-errors').textContent=state.errors?.length?state.errors.map(item=>readable(item.code)).join('; '):'';
  }
  function render() {
    $('#file-order-detail').hidden=!selected;
    if(!selected){list();controls();return;}
    const item=selected,h=item.handoff,r=item.review;
    $('#file-order-title').textContent='Order '+h.orderReference;
    $('#file-order-state').textContent=item.prepared?'Ready for acquisition':item.preparing?'Resume local setup':r?'Reviewed':'Review order';
    $('#file-order-url').textContent=h.purchaseUrl;
    $('#file-order-summary').innerHTML=`<div><dt>File size</dt><dd>${bytes(h.file.bytes)}</dd></div><div><dt>Merchant price</dt><dd>${escape(h.payment.amount)} atomic · ${escape(h.payment.network)}</dd></div><div><dt>Asset</dt><dd><code>${escape(h.payment.asset)}</code></dd></div><div><dt>Recipient</dt><dd><code>${escape(h.payment.payTo)}</code></dd></div><div><dt>Approved file SHA-256</dt><dd><code>${escape(h.file.sha256)}</code></dd></div><div><dt>Customer delivery URL</dt><dd><code>${escape(h.deliveryUrl)}</code></dd></div>`;
    $('#file-handoff-download').href='/files/paid-files/'+item.id+'/handoff';
    $('#file-total').value=r?.totalAtomic??h.payment.amount;
    $('#file-daily').value=r?.dailyAtomic??h.payment.amount;
    $('#file-save-name').value=r?.filename??'order-'+item.id.slice(5,17)+'.bin';
    $('#file-claim-env').innerHTML=(item.claimEnvs??state.claimEnvs).map(entry=>
      `<option value="${escape(entry.name)}" ${r?.claimEnv===entry.name?'selected':''}>${escape(entry.name)} · ${entry.available?'available':'set on this host before delivery'}</option>`).join('');
    $('#file-review-saved').hidden=!r;
    $('#file-review-saved').innerHTML=r?`<strong>Reviewed for ${escape(r.operator.actor)}</strong><p>${escape(r.totalAtomic)} total atomic · ${escape(r.dailyAtomic)} per UTC day · save as <code>${escape(r.filename)}</code>.</p><p class="muted">Revision ${r.revision} · ${escape(new Date(r.reviewedAt).toLocaleString())}</p>`:'';
    $('#prepare-file-order').textContent=item.preparing&&!item.prepared?'Resume local buyer setup':'Prepare local buyer';
    $('#file-prepared').hidden=!item.prepared;
    $('#file-prepared-name').textContent=item.prepared?.configName??'';
    changed=false;$('#file-review-changed').hidden=true;list();controls();
  }
  async function open(id) {
    const next=++generation;openPanel();notice('');
    const value=await request('/api/paid-files/'+id);
    if(next!==generation)return;selected=value;render();
  }
  async function work(fn) {
    if(busy)return;busy=true;controls();notice('');
    try{await fn();}catch(error){notice(error.message,true);}
    finally{busy=false;controls();}
  }
  for(const id of ['open-paid-files','welcome-paid-files'])$('#'+id).addEventListener('click',()=>{openPanel();list();});
  $('#file-order-list').addEventListener('click',event=>{
    const row=event.target.closest('[data-file-order]');if(row&&!busy)open(row.dataset.fileOrder).catch(error=>notice(error.message,true));
  });
  $('#file-upload-form').addEventListener('submit',event=>{event.preventDefault();work(async()=>{
    const file=$('#file-handoff-upload').files[0];
    if(!file||file.size===0||file.size>state.maxHandoffBytes)throw new Error('Choose the merchant file-order handoff, up to 128 KiB.');
    const raw=new Uint8Array(await file.arrayBuffer());let binary='';
    for(let offset=0;offset<raw.length;offset+=16384)binary+=String.fromCharCode(...raw.subarray(offset,offset+16384));
    selected=await request('/api/paid-files/upload',{filename:file.name,base64:btoa(binary)});
    generation++;await refreshState();render();$('#file-handoff-upload').value='';
    notice(selected.prepared?'This order already has a prepared buyer. Continue with its saved acquisition.':'Order retained. Review its price, local budget and download name.');
  });});
  $('#file-review-form').addEventListener('input',()=>{changed=true;$('#file-review-changed').hidden=!selected?.review;controls();});
  $('#file-review-form').addEventListener('submit',event=>{event.preventDefault();work(async()=>{
    if(!selected)throw new Error('Open a received file order first.');
    selected=await request('/api/paid-files/review',{id:selected.id,expectedRevision:selected.review?.revision??0,
      totalAtomic:$('#file-total').value,dailyAtomic:$('#file-daily').value,
      filename:$('#file-save-name').value,claimEnv:$('#file-claim-env').value});
    render();notice('Order review saved. Prepare the original local buyer to continue.');
  });});
  $('#prepare-file-order').addEventListener('click',()=>work(async()=>{
    if(!selected?.review||changed)throw new Error('Save the current order review first.');
    notice('Preparing the original buyer and its retained spending ledger…');
    await request('/api/paid-files/prepare',{id:selected.id,reviewSha256:selected.review.reviewSha256});
    selected=await request('/api/paid-files/'+selected.id);await refreshState();render();
    notice('Buyer prepared. Add this order to an acquisition plan.');
  }));
  $('#add-file-to-plan').addEventListener('click',()=>work(()=>onPrepared(selected.prepared,selected)));
  $('#run-operations').addEventListener('click',event=>{
    const button=event.target.closest('[data-retrieve-file],[data-reset-file]');if(!button)return;
    const id=button.dataset.retrieveFile??button.dataset.resetFile;
    const row=current()?.state.operations.find(item=>item.id===id);
    if(!row?.paidFile||row.paidFile.error)return;
    action(button.hasAttribute('data-reset-file')?'reset-file-transfer':'retrieve-file',
      {only:id,configSha256:row.paidFile.configSha256,handoffSha256:row.paidFile.handoffSha256})
      .catch(error=>notice(error.message,true));
  });
  return {update(value){state=value??{requests:[],claimEnvs:[]};list();controls();},
    operation(row,{runId,disabled}) {
      const file=row.paidFile;if(!file)return '';
      if(file.error)return `<section class="operation-paid-file"><h4>Customer file</h4><p>${escape(readable(file.error))}</p></section>`;
      const transfer=file.transfer,delivery=file.delivery;
      const title=delivery.available?'Check saved file':transfer?.resumable?'Resume entitled file':'Retrieve entitled file';
      const unavailable=disabled||!file.claimAvailable&&!['SAVED','LOCAL_FILE_REQUIRES_CHECK'].includes(delivery.status);
      return `<section class="operation-paid-file"><div class="section-heading"><h4>Customer file · ${escape(file.orderReference)}</h4><span class="badge">${escape(readable(delivery.status))}</span></div><dl class="detail-grid"><div><dt>Promised size</dt><dd>${bytes(file.file.bytes)}</dd></div><div><dt>Retained transfer</dt><dd>${transfer?bytes(transfer.retainedBytes)+' · '+escape(readable(transfer.status)):'Ready to retrieve'}</dd></div><div><dt>File SHA-256</dt><dd><code>${escape(file.file.sha256)}</code></dd></div><div><dt>Claim token environment</dt><dd>${escape(file.claimEnv)} · ${file.claimAvailable?'available':'set on this host'}</dd></div></dl><div class="toolbar"><button data-retrieve-file="${escape(row.id)}" ${unavailable?'disabled':''}>${title}</button>${transfer?.canReset?`<button data-reset-file="${escape(row.id)}" ${disabled?'disabled':''}>Discard partial transfer</button>`:''}${delivery.available?`<a class="button" href="/files/${runId}/paid-files/${escape(row.id)}">Download customer file</a>`:''}</div><p class="muted">The merchant checks this order’s current entitlement. The saved acquisition keeps the purchase outcome and file delivery together.</p>${transfer?.lastError?`<p class="muted">${escape(readable(transfer.lastError))}</p>`:''}</section>`;
    }};
}
