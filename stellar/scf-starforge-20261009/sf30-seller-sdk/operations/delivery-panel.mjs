// Read-only local SF98 delivery view. No payment, webhook or wallet actions.
const $ = id => document.getElementById(id);
let previous = null;
function show(data) {
  previous = data;
  if (!data.available) {
    $('fulfillment-status').textContent = 'Native merchant journal not attached';
    return;
  }
  $('fulfillment-status').textContent = 'Last read ' + new Date(data.capturedAt).toLocaleTimeString();
  for (const [node,key] of [['fulfillment-native','originalNativeEvents'],
    ['fulfillment-sent','webhookAccepted'],['fulfillment-pending','pending'],
    ['fulfillment-exhausted','exhausted']]) $(node).textContent = String(data[key]);
  const rows = document.createDocumentFragment();
  for (const e of data.recent) {
    const tr = document.createElement('tr');
    for (const value of [e.id.slice(0,14), e.routeId, e.state, e.attempts,
      e.nextRetryAt ?? '—']) {
      const td = document.createElement('td');
      td.textContent = String(value); tr.append(td);
    }
    rows.append(tr);
  }
  $('fulfillment-events').replaceChildren(rows);
  $('fulfillment-exceptions').textContent = data.exhausted
    ? String(data.exhausted) + ' exhausted deliveries require operator review'
    : String(data.retryDue) + ' pending events due for explicit drain';
}
async function update() {
  try {
    const res = await fetch('/api/delivery',{cache:'no-store'});
    if(!res.ok)throw Error('journal read');
    const data=await res.json();
    if(data.schema!=='stellar-forge.sf98.operator-delivery.v1')throw Error('schema');
    show(data);
  } catch { $('fulfillment-status').textContent='Journal unavailable; seller traffic unaffected'; }
}
document.addEventListener('visibilitychange',()=>{if(!document.hidden)update();});
update();
setInterval(()=>{if(!document.hidden)update();},8000);
