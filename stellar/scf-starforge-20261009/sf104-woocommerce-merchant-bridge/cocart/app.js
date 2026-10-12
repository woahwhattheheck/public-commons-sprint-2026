const $=s=>document.querySelector(s);
let workspace=null,token=null,selected=null,busy=false;
const escape=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const money=(n,p)=>{try{let s=BigInt(n).toString().padStart(p+1,'0');return p?s.slice(0,-p)+'.'+s.slice(-p):s;}catch{return String(n);}};
const short=s=>String(s??'').slice(0,12);
const currentCart=()=>workspace?.carts.find(c=>c.id===selected);
const currentSnapshot=c=>c?.snapshots.find(s=>s.id===c.current_snapshot);
function status(message,error=false){const e=$('#status');e.textContent=message;e.classList.toggle('error',error);}
function setBusy(value){busy=value;document.querySelectorAll('button').forEach(b=>{b.disabled=value;});if(!selected){$('#refresh-cart').disabled=true;document.querySelectorAll('[data-product]').forEach(b=>b.disabled=true);}}
function objectLink(ref,label='Original response'){return ref?'<a href="/api/objects/'+escape(ref.sha256)+'" download>'+escape(label)+'</a>':'';}
function linesTable(c) {
  if(!c.items.length)return '<p class="empty">This native cart is empty.</p>';
  return '<div class="table-wrap"><table><thead><tr><th>Product</th><th>Quantity</th><th>Unit price</th><th>Cart action</th></tr></thead><tbody>'+c.items.map(i=>'<tr><td><strong>'+escape(i.name)+'</strong><small>Woo '+escape(i.product_id)+(i.sku?' · '+escape(i.sku):'')+'</small></td><td><input aria-label="Quantity for '+escape(i.name)+'" data-quantity="'+escape(i.item_key)+'" type="number" min="0" max="100000" value="'+i.quantity+'"></td><td>'+escape(c.currency)+' '+escape(money(i.unit_minor,c.precision))+'</td><td><button data-update="'+escape(i.item_key)+'">Set quantity</button> <button data-remove="'+escape(i.item_key)+'">Remove</button></td></tr>').join('')+'</tbody></table></div>';
}
function render() {
  if(!workspace)return;
  const before=selected; if(!workspace.carts.some(c=>c.id===selected))selected=workspace.carts[0]?.id||null;
  $('#store-line').textContent=workspace.profile.label+' · '+workspace.profile.store_url+' · revision '+workspace.revision;
  $('#cart-list').innerHTML=workspace.carts.map(c=>'<button class="cart-select '+(c.id===selected?'selected':'')+'" data-cart="'+escape(c.id)+'"><strong>'+escape(c.label)+'</strong><small>'+escape(c.updated_at)+' · '+c.operations.length+' operations</small></button>').join('')||'<p class="empty">Create a named customer cart to begin.</p>';
  document.querySelectorAll('[data-cart]').forEach(b=>b.addEventListener('click',()=>{selected=b.dataset.cart;render();}));
  const cart=currentCart(),snap=currentSnapshot(cart),projection=snap?.projection;
  $('#cart-title').textContent=cart?.label||'Select a customer cart';
  $('#cart-meta').textContent=cart?'Guest session '+short(cart.cart_key)+'… · refreshed '+(snap?.at||''):'';
  $('#refresh-cart').disabled=busy||!cart;
  for(const id of ['mutation-section','checkout-section','operations-section'])$('#'+id).hidden=!cart;
  if(projection) {
    $('#cart-content').innerHTML=linesTable(projection)+'<div class="totals"><span>Native total</span><strong>'+escape(projection.currency)+' '+escape(projection.total_display)+'</strong><small>'+projection.items.length+' product lines · '+projection.item_count+' items</small></div><details><summary>Server totals and source</summary><pre>'+escape(JSON.stringify({currency:projection.currency,precision:projection.precision,minor_unit_totals:projection.totals,cart_hash:projection.cart_hash},null,2))+'</pre>'+objectLink(snap.exchange)+'</details>';
    $('#removed-items').innerHTML=projection.removed_items.length?'<h3>Removed items</h3>'+projection.removed_items.map(x=>'<p>'+escape(x.name||x.id)+' <button data-restore="'+escape(x.item_key)+'">Restore</button></p>').join(''):'';
    document.querySelectorAll('[data-update]').forEach(b=>b.addEventListener('click',()=>mutate({action:'quantity',item_key:b.dataset.update,quantity:Number(document.querySelector('[data-quantity="'+CSS.escape(b.dataset.update)+'"]').value)})));
    document.querySelectorAll('[data-remove]').forEach(b=>b.addEventListener('click',()=>mutate({action:'remove',item_key:b.dataset.remove})));
    document.querySelectorAll('[data-restore]').forEach(b=>b.addEventListener('click',()=>mutate({action:'restore',item_key:b.dataset.restore})));
  } else $('#cart-content').innerHTML='<p class="empty">The original native cart will appear here.</p>';
  const catalog=workspace.catalogs.at(-1);
  $('#catalog-results').innerHTML=catalog?'<p class="meta">Native page '+escape(catalog.query.page)+(catalog.total_pages?' of '+escape(catalog.total_pages):'')+' · '+catalog.products.length+' products</p>'+catalog.products.map(p=>'<article class="product"><strong>'+escape(p.name||p.id)+'</strong><small>Woo '+escape(p.id)+(p.sku?' · '+escape(p.sku):'')+(p.type?' · '+escape(p.type):'')+'</small><button data-product="'+escape(p.id)+'" '+(!cart?'disabled':'')+'>Add one to selected cart</button></article>').join('')+objectLink(catalog.exchange):'';
  document.querySelectorAll('[data-product]').forEach(b=>b.addEventListener('click',()=>mutate({action:'add',product_id:b.dataset.product,quantity:1})));
  $('#checkout-results').innerHTML=cart?cart.handoffs.slice().reverse().map(h=>{
    const reasons=h.admission.reasons.map(r=>'<li>'+escape(r.message)+'</li>').join('');
    return '<article class="checkout"><div class="section-head"><h3>'+escape(h.storefront.currency)+' '+escape(h.storefront.total)+' · '+escape(h.mode)+' web cart</h3><small>'+escape(h.created_at)+'</small></div><p>'+escape(h.customer_details)+'</p><p><strong>Stellar mapping comparison: '+(h.admission.eligible?'matches selected saved terms':'review cart or mapping')+'</strong></p>'+(reasons?'<ul>'+reasons+'</ul>':'')+'<p><a class="button primary" href="'+escape(h.checkout_url)+'" target="_blank" rel="noreferrer">Open native Woo checkout</a></p><p class="meta">'+escape(h.admission.qualification)+'</p><form data-woo-import="'+escape(h.id)+'"><label>Original Woo order handoff JSON<input type="file" name="handoff" accept=".json,application/json" required></label><button>Receive original order handoff</button></form>'+h.orders.map(o=>'<div class="order"><strong>Woo order '+escape(o.order_reference)+' · attempt '+escape(o.attempt_generation)+'</strong><p>'+escape(o.original_buyer_intent)+'</p>'+objectLink(o.source,'Download original buyer handoff')+'</div>').join('')+'</article>';
  }).join(''):'';
  document.querySelectorAll('[data-woo-import]').forEach(f=>f.addEventListener('submit',async e=>{
    e.preventDefault();const file=f.elements.handoff.files[0];if(!file)return;
    if(file.size>1000000)return status('Select a Woo handoff smaller than 1 MB.',true);
    const bytes=new Uint8Array(await file.arrayBuffer());let raw='';for(const byte of bytes)raw+=String.fromCharCode(byte);
    await perform('woo.attach',{cart_id:selected,preview_id:f.dataset.wooImport,content_base64:btoa(raw)},'Original Woo order handoff received.');
  }));
  let pendingClient=null;try{pendingClient=cart?JSON.parse(sessionStorage.getItem('cocart-pending:'+cart.id)||'null'):null;}catch{}
  $('#client-recovery').innerHTML=pendingClient?'<p>A client request is retained after an interrupted response. <button id="resume-client-request">Reconcile the same request</button></p>':'';
  if(pendingClient)$('#resume-client-request').addEventListener('click',async()=>{
    const result=await perform('cart.mutate',pendingClient,'Original client request reconciled.');
    if(result){sessionStorage.removeItem('cocart-pending:'+pendingClient.cart_id);render();}
  });
  $('#operations').innerHTML=cart?cart.operations.slice().reverse().map(o=>{
    const recover=['DISPATCHING','UNCERTAIN','APPLIED_REFRESH_REQUIRED'].includes(o.status);
    return '<details class="operation" '+(recover?'open':'')+'><summary><strong>'+escape(o.plan.action)+'</strong> · '+escape(o.status)+' <small>'+escape(o.created_at)+'</small></summary><pre>'+escape(JSON.stringify(o.plan,null,2))+'</pre><p>'+escape(o.error?.message||'')+'</p>'+o.exchanges.map(r=>objectLink(r)).join(' · ')+(o.status==='PREPARED'?'<button data-apply="'+escape(o.id)+'">Continue original prepared operation</button>':'')+'<button data-inspect="'+escape(o.id)+'">Read current cart for this operation</button>'+(recover?'<form data-resolve="'+escape(o.id)+'"><label>Resolution<select name="decision"><option value="accept_current">Accept the current native cart state</option><option value="confirmed_not_applied">Original native action was not applied</option></select></label><label>Native observation supporting this resolution<textarea name="reason" required minlength="8" maxlength="2000"></textarea></label><button>Save recovery decision</button></form>':'')+(o.reconciliations?.length?'<p>'+o.reconciliations.length+' retained cart readback/recovery decisions.</p>':'')+'</details>';
  }).join(''):'';
  document.querySelectorAll('[data-apply]').forEach(b=>b.addEventListener('click',()=>perform('cart.apply',{cart_id:selected,operation_id:b.dataset.apply},'Original cart operation returned.')));
  document.querySelectorAll('[data-inspect]').forEach(b=>b.addEventListener('click',()=>perform('cart.reconcile',{cart_id:selected,operation_id:b.dataset.inspect,decision:'inspect'},'Current native cart attached to the original operation.')));
  document.querySelectorAll('[data-resolve]').forEach(f=>f.addEventListener('submit',e=>{e.preventDefault();perform('cart.reconcile',{cart_id:selected,operation_id:f.dataset.resolve,decision:f.elements.decision.value,reason:f.elements.reason.value},'Original recovery decision saved.');}));
  $('#history').innerHTML='<details><summary>'+workspace.events.length+' retained events</summary><ol class="history">'+workspace.events.slice().reverse().map(e=>'<li><strong>'+escape(e.type)+'</strong><small>'+escape(e.at)+'</small><pre>'+escape(JSON.stringify(e.detail,null,2))+'</pre></li>').join('')+'</ol></details>';
  if(before!==selected)$('#add-item').reset();
  if(busy)setBusy(true);
}
async function refresh() {
  const r=await fetch('/api/workspace',{cache:'no-store'}),data=await r.json();
  if(!r.ok)throw new Error(data.message||'The workspace could not be read.');
  workspace=data.workspace;token=data.web_token;render();
}
async function perform(action,payload,message) {
  if(busy)return;
  setBusy(true);status('Working with the original '+(action.startsWith('cart.')?'cart':'workspace')+'…');
  try {
    const r=await fetch('/api/action',{method:'POST',headers:{'Content-Type':'application/json','X-CoCart-Workspace':token},body:JSON.stringify({action,payload,version:workspace.version})});
    const data=await r.json();
    if(!r.ok){const err=new Error(data.message||data.error||'The native action failed.');err.detail=data;throw err;}
    if(data.workspace)workspace=data.workspace;
    if(data.cart)selected=data.cart.id;
    render();
    const state=data.operation?.status;
    const failed=state&&['UNCERTAIN','DISPATCHING','STALE','NATIVE_REJECTED','APPLIED_REFRESH_REQUIRED'].includes(state);
    status(failed?'Original operation: '+state+'. '+(data.operation.error?.message||'Review its retained state below.'):(message||'Saved.'),!!failed);
    return data;
  }catch(e){
    status(e.message+(e.detail?.details?' '+JSON.stringify(e.detail.details):''),true);
    try{await refresh();}catch{}
  }finally{setBusy(false);render();}
}
async function mutate(payload) {
  const requestId=crypto.randomUUID();const key='cocart-pending:'+selected;
  const retained={...payload,cart_id:selected,request_id:requestId};
  sessionStorage.setItem(key,JSON.stringify(retained));
  const result=await perform('cart.mutate',retained,'Native cart updated.');
  if(result)sessionStorage.removeItem(key);
}
$('#refresh-workspace').addEventListener('click',async()=>{if(busy)return;setBusy(true);try{await refresh();status('Original workspace refreshed.');}catch(e){status(e.message,true);}finally{setBusy(false);}});
$('#new-cart').addEventListener('submit',e=>{e.preventDefault();const f=e.currentTarget;perform('cart.create',{label:f.elements.label.value,cart_key:f.elements.cart_key.value.trim()||undefined},'Customer cart received.');});
$('#catalog').addEventListener('submit',e=>{e.preventDefault();const f=e.currentTarget;perform('catalog.load',{search:f.elements.search.value,page:Number(f.elements.page.value),per_page:Number(f.elements.per_page.value)},'Native catalog loaded.');});
$('#add-item').addEventListener('submit',e=>{e.preventDefault();const f=e.currentTarget;mutate({action:'add',product_id:f.elements.product_id.value,quantity:Number(f.elements.quantity.value)});});
$('#refresh-cart').addEventListener('click',()=>perform('cart.refresh',{cart_id:selected},'Current native cart retained.'));
$('#calculate').addEventListener('click',()=>mutate({action:'calculate'}));
$('#clear-cart').addEventListener('click',()=>mutate({action:'clear'}));
$('#checkout').addEventListener('submit',e=>{e.preventDefault();perform('checkout.prepare',{cart_id:selected,mode:e.currentTarget.elements.mode.value},'Current cart is ready to continue in Woo checkout.');});
refresh().then(()=>status('Original workspace opened.')).catch(e=>status(e.message,true));
