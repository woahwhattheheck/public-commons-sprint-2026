// MIT. Private operator controls for the original native delivery journal.
import {createIncidentPanel} from './delivery-incidents-panel.mjs';
const $ = id => document.getElementById(id);
const fragment = new URLSearchParams(location.hash.slice(1));
const candidateToken = fragment.get('control');
const token = /^[a-f0-9]{64}$/.test(candidateToken ?? '') ? candidateToken : null;
let selectedId = /^[a-f0-9]{64}$/.test(fragment.get('event') ?? '') ? fragment.get('event') : null;
let detail = null, control = null, page = null, cursors = [null], pageNumber = 0;
let refreshing = false, refreshAgain = false, recovering = false, generation = 0, recoveryId = null;
const stateName = state => ({PENDING:'Pending',RETRY:'Retry waiting',REQUEUE:'Requeued',
  DELIVERED:'Receiver accepted',EXHAUSTED:'Needs attention'})[state] ?? state;
const date = value => value ? new Date(value).toLocaleString() : '—';
const errors = {
  DELIVERY_STATE_CHANGED:'This event changed after you opened it. The current state has been refreshed. Review it before trying again.',
  DELIVERY_NOT_EXHAUSTED:'This event no longer needs requeueing. The current state has been refreshed.',
  DELIVERY_WORKER_ACTIVE:'The delivery worker is active. Use its receiver workspace to pause the owned worker, then retry here.',
  DELIVERY_CONTROL_REQUIRED:'Open the private fulfillment control link printed by the merchant launcher to enable recovery.',
  DELIVERY_EVENT_NOT_FOUND:'This event is no longer present in the attached journal.',
  DELIVERY_OUTBOX_UNAVAILABLE:'The merchant delivery journal is not attached.',
  DELIVERY_INCIDENT_MERCHANT_MISMATCH:'The monitor registration must match this seller and operations address. Update the original monitor registration to reconnect these incidents.',
  DELIVERY_INCIDENT_UNAVAILABLE:'The original incident monitor is unavailable. Check its configured private state directory.',
  DELIVERY_INCIDENT_STATE_CHANGED:'This incident changed. Its latest state has been refreshed; review it before acknowledging.',
  DELIVERY_INCIDENT_NOT_OPEN:'This incident is already acknowledged or closed. Its latest state has been refreshed.',
  DELIVERY_INCIDENT_OPERATOR_REQUIRED:'Enter the operator’s name, up to 160 UTF-8 bytes on one line.',
  DELIVERY_INCIDENT_NOTE_INVALID:'Use notes of up to 2,000 UTF-8 bytes without control characters.',
  DELIVERY_INCIDENT_NOT_FOUND:'This incident is no longer present for the registered merchant.',
  DELIVERY_INCIDENT_CURSOR_CHANGED:'Retained incident history changed. Returning to its first page.',
  DELIVERY_INCIDENT_BUSY:'The original incident store is busy. Refresh and retry the acknowledgment.',
};
async function request(path,options) {
  const response = await fetch(path,{cache:'no-store',...options});
  let data;
  try { data=await response.json(); }
  catch { throw new Error('The operator service is unavailable. Refresh to reconnect.'); }
  if (!response.ok) throw Object.assign(new Error(errors[data.error] ?? 'The delivery operation could not complete. Refresh the current state and retry.'),{code:data.error});
  return data;
}
function selectionHash() {
  const hash = new URLSearchParams(location.hash.slice(1));
  if (token) hash.set('control',token);
  if (selectedId) hash.set('event',selectedId);else hash.delete('event');
  history.replaceState(null,'',location.pathname+(hash.size ? '#'+hash : ''));
}
function showSummary(data) {
  if (!data.available) { $('fulfillment-status').textContent='Merchant delivery journal not attached'; return; }
  $('fulfillment-status').textContent='Journal updated '+date(data.capturedAt)+' · Refreshes every 8 seconds';
  for (const [node,key] of [['fulfillment-native','originalNativeEvents'],['fulfillment-sent','webhookAccepted'],
    ['fulfillment-pending','pending'],['fulfillment-exhausted','exhausted']]) $(node).textContent=String(data[key]);
  $('fulfillment-exceptions').textContent=data.exhausted
    ? data.exhausted+' exhausted '+(data.exhausted===1?'notification needs':'notifications need')+' review across the complete journal.'
    : 'No exhausted notifications. All retained events remain available in the filters.';
}
function showPage(data) {
  page=data;
  const prior=$('route-filter').value;
  const routes=[Object.assign(document.createElement('option'),{value:'',textContent:'All routes'}),
    ...data.routes.map(route=>Object.assign(document.createElement('option'),{value:route,textContent:route}))];
  $('route-filter').replaceChildren(...routes); $('route-filter').value=prior;
  const rows=document.createDocumentFragment();
  for (const event of data.events) {
    const tr=document.createElement('tr'); tr.setAttribute('aria-selected',String(event.id===selectedId));
    const identity=document.createElement('td'),button=document.createElement('button'),fingerprint=document.createElement('small');
    button.type='button'; button.textContent=event.orderReference ?? event.id.slice(0,16);
    button.setAttribute('aria-label','Inspect '+(event.orderReference ?? event.id));
    button.addEventListener('click',()=>selectEvent(event.id));
    fingerprint.textContent=event.id.slice(0,14)+'…'; identity.append(button,fingerprint); tr.append(identity);
    for (const value of [event.routeId,stateName(event.state),event.attempts]) {
      const cell=document.createElement('td'); cell.textContent=String(value); tr.append(cell);
    }
    rows.append(tr);
  }
  $('fulfillment-events').replaceChildren(rows);
  $('empty-queue').hidden=data.events.length>0;
  $('page-status').textContent=data.totalMatching+' '+(data.totalMatching===1?'event':'events')+' · Page '+(pageNumber+1);
  $('previous-page').disabled=pageNumber===0;
  $('next-page').disabled=!data.nextCursor;
}
function showDetail(data) {
  detail=data; const event=data.event;
  $('event-detail').hidden=false; $('detail-prompt').textContent='Current state of the selected original event';
  $('event-state').textContent=stateName(event.state); $('event-order').textContent=event.orderReference ?? 'Unlinked order';
  const fields=document.createDocumentFragment();
  for (const [label,value,mono] of [['Event ID',event.id,true],['Route',event.method+' · '+event.routeId],
    ['Recorded payment',date(event.nativeRecordedAt)],['Last delivery change',date(event.lastChangedAt)],
    ['Delivery attempts',String(event.attempts)],['Last receiver response',event.lastWebhookHttp ? 'HTTP '+event.lastWebhookHttp : '—'],
    ['Next retry',date(event.nextRetryAt)],['Network',event.network ?? '—']]) {
    const term=document.createElement('dt'),description=document.createElement('dd');
    term.textContent=label;description.textContent=value;if(mono)description.className='mono';fields.append(term,description);
  }
  $('event-fields').replaceChildren(fields);
  const authorized=control?.controlsEnabled && token;
  $('requeue').disabled=recovering || !authorized || !data.requeueAvailable;
  $('requeue').textContent=recovering ? 'Requeuing…' : 'Requeue notification';
  $('recovery-guidance').textContent=event.state==='EXHAUSTED'
    ? (!authorized ? errors.DELIVERY_CONTROL_REQUIRED : data.managedWorker
      ? 'After repairing the receiver, requeue this notification. The receiver workspace pauses and resumes its owned worker with the same pinned profile.'
      : 'After repairing the receiver, requeue this notification while the original delivery worker is paused. Resume that worker to send it.')
    : event.state==='DELIVERED' ? 'The receiver accepted this notification. Open the merchant application to check the purchased resource.'
    : 'This event is already pending in the original delivery queue. Its worker will use the configured retry schedule.';
  if(recoveryId===event.id && event.state==='DELIVERED') $('recovery-result').textContent='Recovered: the receiver accepted the original notification. The recorded payment was reused.';
}
async function selectEvent(id) {
  selectedId=id; detail=null; generation++; selectionHash();
  $('recovery-result').textContent=''; $('requeue').disabled=true;
  if(page)showPage(page);
  const selectedGeneration=generation;
  try { const data=await request('/api/delivery/event?id='+id);
    if(selectedGeneration===generation)showDetail(data);
  } catch(error) { if(selectedGeneration===generation) { $('event-detail').hidden=true; $('detail-prompt').textContent=error.message; } }
}
async function refresh() {
  if(refreshing){refreshAgain=true;return;} refreshing=true; $('refresh').disabled=true;
  // Incident availability cannot hide the merchant's original event queue.
  incidentPanel.refresh();
  const selectedGeneration=generation;
  const query=new URLSearchParams({state:$('state-filter').value,limit:'25'});
  if(cursors[pageNumber])query.set('cursor',cursors[pageNumber]);
  if($('route-filter').value)query.set('routeId',$('route-filter').value);
  try {
    const [summary,nextControl,nextPage,nextDetail]=await Promise.all([
      request('/api/delivery'),request('/api/delivery/control'),request('/api/delivery/events?'+query),
      selectedId ? request('/api/delivery/event?id='+selectedId) : null]);
    if(selectedGeneration!==generation)return;
    control=nextControl;showSummary(summary);showPage(nextPage);
    $('receiver-workspace-link').hidden=!control.receiverWorkspace;
    $('control-status').textContent=control.controlsEnabled && token ? 'Private controls enabled' : 'Read only';
    if(nextDetail)showDetail(nextDetail);
  } catch(error) { $('fulfillment-status').textContent=error.message; }
  finally { refreshing=false;$('refresh').disabled=false;
    if(refreshAgain){refreshAgain=false;refresh();}
  }
}
async function recover() {
  if(recovering || !token || !detail?.requeueAvailable)return;
  const command={id:detail.event.id,expectedRevision:detail.revision};
  recovering=true;showDetail(detail);$('recovery-result').textContent='Requeuing the selected notification…';
  try {
    await request('/api/delivery/requeue',{method:'POST',headers:{'content-type':'application/json','x-delivery-control':token},body:JSON.stringify(command)});
    recoveryId=command.id;
    if(selectedId===command.id)$('recovery-result').textContent='Notification requeued. Waiting for the original delivery worker and receiver.';
  } catch(error) { if(selectedId===command.id)$('recovery-result').textContent=error.message; }
  finally { recovering=false; await refresh(); if(detail)showDetail(detail); }
}
const incidentPanel=createIncidentPanel({token,request,onQueue:state=>{
  $('state-filter').value=state;$('route-filter').value='';cursors=[null];pageNumber=0;generation++;refresh();
  document.querySelector('.workspace').scrollIntoView({behavior:'smooth',block:'start'});
}});
for(const id of ['state-filter','route-filter'])$(id).addEventListener('change',()=>{
  cursors=[null];pageNumber=0;generation++;refresh();
});
$('next-page').addEventListener('click',()=>{if(page?.nextCursor){cursors[++pageNumber]=page.nextCursor;generation++;refresh();}});
$('previous-page').addEventListener('click',()=>{if(pageNumber){pageNumber--;generation++;refresh();}});
$('refresh').addEventListener('click',refresh);$('requeue').addEventListener('click',recover);
$('export-event').addEventListener('click',()=>{
  if(!detail)return;const url=URL.createObjectURL(new Blob([JSON.stringify(detail,null,2)+'\n'],{type:'application/json'}));
  const link=document.createElement('a');link.href=url;link.download='delivery-'+detail.event.id+'.json';link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
});
document.addEventListener('visibilitychange',()=>{if(!document.hidden)refresh();});
refresh();setInterval(()=>{if(!document.hidden)refresh();},8000);
