// MIT. Original SF93 observations and operator acknowledgments on fulfillment.
const $=id=>document.getElementById(id);
const uuid=value=>/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(value ?? '');
const date=value=>value?new Date(value).toLocaleString():'—';
const kind=value=>({DELIVERY_EXHAUSTED:'Exhausted delivery notifications',DELIVERY_BACKLOG:'Delivery backlog',
  DELIVERY_UNAVAILABLE:'Delivery journal unavailable',SELLER_UNAVAILABLE:'Seller unavailable',
  OPERATIONS_UNAVAILABLE:'Operations unavailable',HTTP_ERRORS:'Elevated HTTP errors',
  DISCONNECTS:'Elevated disconnects'})[value] ?? value.replaceAll('_',' ').toLowerCase();
const status=value=>({OPEN:'Open',ACKNOWLEDGED:'Acknowledged',RECOVERED:'Recovery observed',RETIRED:'Source registration changed'})[value] ?? value;
const signal=value=>value?Object.entries(value).map(([key,item])=>key.replaceAll(/([A-Z])/g,' $1').toLowerCase()+': '+
  (typeof item==='object'?JSON.stringify(item):String(item))).join(' · '):'—';

export function createIncidentPanel({token,onQueue,request}) {
  let selectedId=new URLSearchParams(location.hash.slice(1)).get('incident');
  if(!uuid(selectedId))selectedId=null;
  let page=null,detail=null,cursors=[null],pageNumber=0,generation=0;
  let refreshing=false,refreshAgain=false,acknowledging=false;
  function selectionHash() {
    const hash=new URLSearchParams(location.hash.slice(1));
    if(selectedId)hash.set('incident',selectedId);else hash.delete('incident');
    history.replaceState(null,'',location.pathname+(hash.size?'#'+hash:''));
  }
  function showPage(data) {
    page=data;$('incident-monitor').hidden=false;
    $('incident-count').textContent=data.active+' active';
    const worker=data.worker;
    $('incident-watch-status').textContent=!worker?.lastSweepAt?'Waiting for the monitor’s first observation.':
      worker.status==='STOPPED'?'Monitor stopped · Last observation '+date(worker.lastSweepAt):
      worker.heartbeatAgeSeconds>data.staleAfterSeconds?'Monitor observation is overdue · Last observed '+date(worker.lastSweepAt):
      'Last observed '+date(worker.lastSweepAt)+(worker.lastError?' · '+worker.lastError:'');
    const list=document.createDocumentFragment();
    for(const item of data.incidents) {
      const button=document.createElement('button'),label=document.createElement('strong'),note=document.createElement('span');
      button.type='button';button.className='incident-item';button.setAttribute('aria-pressed',String(item.id===selectedId));
      label.textContent=kind(item.kind);note.textContent=status(item.status)+' · '+date(item.openedAt);
      button.append(label,note);button.addEventListener('click',()=>select(item.id));list.append(button);
    }
    $('incident-list').replaceChildren(list);$('incident-empty').hidden=data.incidents.length>0;
    $('incident-page-status').textContent=data.totalMatching+' retained · Page '+(pageNumber+1);
    $('incident-previous').disabled=pageNumber===0;$('incident-next').disabled=!data.nextCursor;
  }
  function showDetail(data) {
    detail=data;const item=data.incident;
    $('incident-detail').hidden=false;$('incident-prompt').hidden=true;
    $('incident-state').textContent=status(item.status);$('incident-kind').textContent=kind(item.kind);
    const fields=document.createDocumentFragment();
    const ack=item.acknowledgment;
    for(const [label,value] of [['Merchant',item.merchantLabel],['Incident',item.id],['Opened',date(item.openedAt)],
      ['Last failing observation',date(item.lastObservedAt)],['Recovery observed',item.status==='RECOVERED'?date(item.closedAt):'—'],
      ['Observed signal',signal(item.signal)],['Recovery signal',signal(item.recoverySignal)],
      ['Acknowledged by',ack?ack.by+' · '+date(ack.at):'—'],['Operator notes',ack?.notes || '—'],
      ['Alert delivery',item.notificationIssue ?? item.notificationState ?? 'Not configured'],
      ['Retained captures',(item.beforeCapture?'Before available':'No before capture')+' · '+(item.afterCapture?'After available':'No after capture')]]) {
      const dt=document.createElement('dt'),dd=document.createElement('dd');dt.textContent=label;dd.textContent=value;
      fields.append(dt,dd);
    }
    $('incident-fields').replaceChildren(fields);
    $('incident-scope').textContent=!item.currentMerchantBinding?'This incident belongs to an earlier source registration. Current controls use the registered merchant.':
      item.queueAction?'This observation covers the merchant’s delivery queue. Inspect the original events to identify the affected order. Acknowledgment records ownership; the monitor records recovery when it observes the condition clear.':
      'Acknowledgment records ownership. The monitor records recovery when it observes this condition clear.';
    $('incident-ack-form').hidden=item.status!=='OPEN' || !item.currentMerchantBinding;
    $('incident-ack').disabled=acknowledging || !token;
    $('incident-ack').textContent=acknowledging?'Acknowledging…':'Acknowledge incident';
    if(item.status==='OPEN'&&!token)$('incident-action-result').textContent='Open the private fulfillment control link printed by the merchant launcher to acknowledge this incident.';
    $('incident-open-queue').hidden=!item.queueAction;
  }
  async function select(id) {
    selectedId=id;detail=null;generation++;selectionHash();
    $('incident-by').value='';$('incident-notes').value='';$('incident-action-result').textContent='';
    $('incident-detail').hidden=true;$('incident-prompt').hidden=false;$('incident-prompt').textContent='Reading the selected incident…';
    if(page)showPage(page);
    const selectedGeneration=generation;
    try {const data=await request('/api/delivery/incident?id='+id);if(selectedGeneration===generation)showDetail(data);}
    catch(error){if(selectedGeneration===generation)$('incident-prompt').textContent=error.message;}
  }
  async function refresh() {
    if(refreshing){refreshAgain=true;return;}refreshing=true;
    const selectedGeneration=generation;
    const query=new URLSearchParams({state:$('incident-filter').value,limit:'25'});
    if(cursors[pageNumber])query.set('cursor',cursors[pageNumber]);
    try {
      const data=await request('/api/delivery/incidents?'+query);
      if(selectedGeneration!==generation)return;
      if(!data.available){$('incident-monitor').hidden=true;return;}
      showPage(data);
      if(selectedId) {
        try {const current=await request('/api/delivery/incident?id='+selectedId);if(selectedGeneration===generation)showDetail(current);}
        catch(error){if(selectedGeneration===generation){detail=null;$('incident-detail').hidden=true;$('incident-prompt').hidden=false;$('incident-prompt').textContent=error.message;}}
      }
    } catch(error) {
      $('incident-monitor').hidden=false;$('incident-watch-status').textContent=error.message;
      if(error.code==='DELIVERY_INCIDENT_CURSOR_CHANGED'){cursors=[null];pageNumber=0;generation++;refreshAgain=true;}
    } finally {refreshing=false;if(refreshAgain){refreshAgain=false;refresh();}}
  }
  async function acknowledge() {
    if(acknowledging || !token || detail?.incident.status!=='OPEN')return;
    const command={id:detail.incident.id,expectedRevision:detail.incident.revision,
      by:$('incident-by').value,notes:$('incident-notes').value};
    acknowledging=true;showDetail(detail);$('incident-action-result').textContent='Recording acknowledgment…';
    try {
      const data=await request('/api/delivery/incident/ack',{method:'POST',headers:{'content-type':'application/json','x-delivery-control':token},body:JSON.stringify(command)});
      if(selectedId===command.id){showDetail(data);$('incident-action-result').textContent='Acknowledgment saved in the original monitor. Recovery remains based on its observations.';}
    } catch(error){if(selectedId===command.id)$('incident-action-result').textContent=error.message;}
    finally {acknowledging=false;await refresh();if(detail)showDetail(detail);}
  }
  $('incident-filter').addEventListener('change',()=>{cursors=[null];pageNumber=0;generation++;refresh();});
  $('incident-next').addEventListener('click',()=>{if(page?.nextCursor){cursors[++pageNumber]=page.nextCursor;generation++;refresh();}});
  $('incident-previous').addEventListener('click',()=>{if(pageNumber){pageNumber--;generation++;refresh();}});
  $('incident-ack').addEventListener('click',acknowledge);
  $('incident-open-queue').addEventListener('click',()=>{if(detail?.incident.queueAction)onQueue(detail.incident.queueAction.state);});
  $('incident-export').addEventListener('click',()=>{
    if(!detail)return;const url=URL.createObjectURL(new Blob([JSON.stringify(detail,null,2)+'\n'],{type:'application/json'}));
    const link=document.createElement('a');link.href=url;link.download='incident-'+detail.incident.id+'.json';link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
  });
  return Object.freeze({refresh});
}
