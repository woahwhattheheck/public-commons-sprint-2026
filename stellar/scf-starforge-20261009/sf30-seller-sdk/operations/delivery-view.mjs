// MIT. Read-only SF98 delivery-journal projection for the existing SF30 operator.
// Original native settlement success is not independent chain proof.
const STATES = new Set(['PENDING','RETRY','REQUEUE','DELIVERED','EXHAUSTED']);
const SCHEMA = 'stellar-forge.sf98.operator-delivery.v1';
const validId = x => typeof x === 'string' && /^[a-f0-9]{64}$/.test(x);
const validRoute = x => typeof x === 'string' && /^[A-Za-z0-9_-]{1,80}$/.test(x);
const timestamp = x => typeof x === 'string' && Number.isFinite(Date.parse(x)) ? Date.parse(x) : null;
export function summarizeOutbox(rows, { now = Date.now(), recentLimit = 24 } = {}) {
  if (!Array.isArray(rows) || !Number.isFinite(now) || !Number.isInteger(recentLimit) ||
      recentLimit < 1 || recentLimit > 100) throw new TypeError('Invalid outbox projection');
  const view = { schema:SCHEMA, available:true, capturedAt:new Date(now).toISOString(),
    originalNativeEvents:0, webhookAccepted:0, pending:0, retryDue:0,
    retryWaiting:0, exhausted:0, oldestPendingSeconds:null, recent:[] };
  for (const row of rows) {
    const e=row?.event;
    if (e?.schema !== 'stellar-forge.sf98.delivery-event.v1' ||
        !validId(e.id) || !validRoute(e.routeId)) throw new Error('OUTBOX_EVENT_UNRECOGNIZED');
    const state=row.state?.state ?? 'PENDING';
    if (!STATES.has(state)) throw new Error('OUTBOX_DELIVERY_STATE_UNRECOGNIZED');
    const at=timestamp(e.at), next=timestamp(row.state?.nextAt);
    const age=at===null ? null : Math.max(0,Math.floor((now-at)/1000));
    const active=['PENDING','RETRY','REQUEUE'].includes(state);
    view.originalNativeEvents++;
    if(state==='DELIVERED') view.webhookAccepted++;
    if(state==='EXHAUSTED') view.exhausted++;
    if(active) {
      view.pending++;
      if(age!==null) view.oldestPendingSeconds=Math.max(view.oldestPendingSeconds ?? 0, age);
      if(state==='RETRY' && next!==null && next>now) view.retryWaiting++;
      else view.retryDue++;
    }
    view.recent.push({id:e.id,routeId:e.routeId,
      method:['GET','HEAD','POST'].includes(e.method)?e.method:'OTHER',
      nativeRecordedAt:at===null?null:new Date(at).toISOString(),
      ageSeconds:age,state,
      attempts:Number.isInteger(row.state?.attempt) && row.state.attempt >=0 && row.state.attempt<=100?row.state.attempt:0,
      nextRetryAt:state==='RETRY' && next!==null?new Date(next).toISOString():null,
      lastWebhookHttp:Number.isInteger(row.state?.httpStatus) && row.state.httpStatus>=100 &&
        row.state.httpStatus<=599?row.state.httpStatus:null});
    if(view.recent.length>recentLimit) view.recent.shift();
  }
  view.recent.reverse();
  return view;
}
export function createDeliveryReader(outbox,{clock=()=>Date.now(),cacheMs=7500,recentLimit=24}={}) {
  if(typeof outbox?.rows!=='function') throw new TypeError('Original SF98 outbox required');
  if(!Number.isInteger(cacheMs)||cacheMs<0||cacheMs>30000) throw new RangeError('Bad cache');
  let last=-Infinity,pending;
  return async()=>{
    const now=clock();
    if(pending&&now-last<cacheMs) return pending;
    last=now;
    pending=Promise.resolve().then(()=>outbox.rows()).then(rows=>summarizeOutbox(rows,{now,recentLimit}));
    try{return await pending;}catch(e){pending=null;last=-Infinity;throw e;}
  };
}
export function deliveryCsv(view) {
  if(view?.schema!==SCHEMA) throw new TypeError('Invalid delivery view');
  const columns=['id','routeId','method','nativeRecordedAt','state','attempts','ageSeconds','nextRetryAt','lastWebhookHttp'];
  const safe=v=>String(v??'').replace(/^[\s]*[=+@-]/,m=>"'"+m).replace(/"/g,'""');
  return [columns.join(','),...view.recent.map(row=>columns.map(c=>'"'+safe(row[c])+'"').join(','))].join('\n')+'\n';
}
export function deliveryPrometheus(view){
  if(view?.schema!==SCHEMA)return '';
  const values={sf98_outbox_read_available:1,sf98_original_native_events:view.originalNativeEvents,
    sf98_webhook_accepted:view.webhookAccepted,sf98_delivery_pending:view.pending,
    sf98_delivery_exhausted:view.exhausted,sf98_delivery_retry_due:view.retryDue,
    sf98_delivery_retry_waiting:view.retryWaiting,sf98_oldest_pending_seconds:view.oldestPendingSeconds??0};
  return '\n'+Object.entries(values).map(([k,v])=>'# TYPE '+k+' gauge\n'+k+' '+v+'\n').join('');
}
