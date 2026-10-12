// MIT. Live SF93 operations inside the existing SF74 merchant case workspace.
import {parseWorkspace} from './workspace-file.mjs';

const add=(parent,tag,text,className='')=>{const n=document.createElement(tag);if(text!==undefined)n.textContent=text;if(className)n.className=className;parent.append(n);return n;};
const button=(parent,text,action,className='secondary')=>{const n=add(parent,'button',text,className);n.type='button';n.addEventListener('click',action);return n;};
const labels={ENDPOINT_UNAVAILABLE:'Endpoint unavailable',OBSERVER_INCOMPLETE:'Incomplete observations',HTTP_5XX:'Server errors',
  DISCONNECTED:'Interrupted connections',DELIVERY_UNAVAILABLE:'Delivery unavailable',DELIVERY_BACKLOG:'Delivery backlog',
  DELIVERY_EXHAUSTED:'Delivery attempts exhausted'};
const human=value=>String(value??'').toLowerCase().replaceAll('_',' ').replace(/^\w/,c=>c.toUpperCase());
const when=value=>value?new Date(value).toLocaleString():'—';
const terminal=new Set(['DELIVERED','CANCELLED']);

export function mountIncidentDesk({root,exportCase,importCase}) {
  const abort=new AbortController();
  let destroyed=false,busy=false,sequence=0,selection=0,offset=0,timer=null,current=null,detail=null,selectedId=null;
  let configDirty=false,loadedConfigRevision=null,prepared=null;
  const downloads=new Set();
  root.id='incidents';root.className='card incident-desk';root.hidden=true;
  const heading=add(root,'div',undefined,'section-heading'),copy=add(heading,'div');
  add(copy,'p','Merchant incidents','eyebrow');add(copy,'h2','Operate the live support queue');
  add(copy,'p','Review the merchant’s incidents, record acknowledgment and continue the repair in this workspace.');
  const badge=add(heading,'span','Incident sources','stage-hint');

  const selectionForm=add(root,'form',undefined,'incident-filters');
  const sourceLabel=add(selectionForm,'label','Incident source'),source=add(sourceLabel,'select');source.id='incident-source';
  const searchLabel=add(selectionForm,'label','Search incidents'),search=add(searchLabel,'input');search.type='search';search.maxLength=200;search.id='incident-search';
  const statusLabel=add(selectionForm,'label','State'),stateFilter=add(statusLabel,'select');stateFilter.id='incident-state-filter';
  for(const [value,text] of [['','All states'],['OPEN','Open'],['ACKNOWLEDGED','Acknowledged'],['RECOVERED','Recovered'],['RETIRED','Retired']])
    add(stateFilter,'option',text).value=value;
  const merchantLabel=add(selectionForm,'label','Merchant'),merchant=add(merchantLabel,'select');merchant.id='incident-merchant-filter';
  add(merchant,'option','All merchants').value='';
  const applyFilter=add(selectionForm,'button','Filter','secondary');applyFilter.type='submit';
  const status=add(root,'p','Loading incident sources…','status');status.id='incident-status';status.setAttribute('role','status');status.setAttribute('aria-live','polite');
  const counters=add(root,'div',undefined,'incident-counters');

  const workerPanel=add(root,'div',undefined,'incident-worker');
  const workerCopy=add(workerPanel,'div');add(workerCopy,'h3','Watcher');
  const workerState=add(workerCopy,'p','','incident-worker-state'),workerObserved=add(workerCopy,'p','','hint');
  const workerActions=add(workerPanel,'div',undefined,'actions');
  const start=button(workerActions,'Start watcher here',()=>perform('start',()=>({expectedConfigRevision:current.configRevision,expectedConfigHash:current.configHash})));
  start.id='incident-worker-start';
  const stop=button(workerActions,'Stop this watcher',()=>perform('stop',()=>({})));stop.id='incident-worker-stop';
  const refreshButton=button(workerActions,'Refresh',()=>refresh());refreshButton.id='incident-refresh';
  const liveLabel=add(workerPanel,'label',undefined,'incident-live');const live=add(liveLabel,'input');live.type='checkbox';live.checked=true;
  add(liveLabel,'span','Refresh active operations');live.addEventListener('change',schedule,{signal:abort.signal});

  const listWrap=add(root,'div',undefined,'case-table-wrap');
  const listTable=add(listWrap,'table',undefined,'case-table incident-table');listTable.setAttribute('aria-label','Merchant incidents');
  const listHead=add(add(listTable,'thead'),'tr');
  for(const text of ['Merchant / condition','State','Opened','Last observed','Notification'])add(listHead,'th',text).scope='col';
  const listRows=add(listTable,'tbody');
  const paging=add(root,'div',undefined,'actions case-pagination'),count=add(paging,'span','','hint');
  const previous=button(paging,'Previous',()=>{offset=Math.max(0,offset-20);refresh();});
  const next=button(paging,'Next',()=>{offset+=20;refresh();});

  const details=add(root,'section',undefined,'incident-detail');details.hidden=true;
  const detailHeader=add(details,'div',undefined,'section-heading'),detailCopy=add(detailHeader,'div');
  const detailTitle=add(detailCopy,'h3',''),detailIdentity=add(detailCopy,'p','','hint');
  const closeDetail=button(detailHeader,'Close incident',()=>{if(busy)return;selection++;sequence++;selectedId=null;detail=null;clearPrepared();drawDetail();drawList();schedule();});
  const facts=add(details,'div',undefined,'scope');
  const acknowledgeForm=add(details,'form',undefined,'incident-ack-form');
  const operatorLabel=add(acknowledgeForm,'label','Operator name'),operator=add(operatorLabel,'input');
  operator.id='incident-operator';operator.required=true;operator.maxLength=160;operator.autocomplete='name';
  const notesLabel=add(acknowledgeForm,'label','Acknowledgment note'),notes=add(notesLabel,'textarea');notes.id='incident-notes';notes.maxLength=2000;notes.rows=2;
  const ackActions=add(acknowledgeForm,'div',undefined,'actions full');
  const acknowledge=add(ackActions,'button','Acknowledge incident');acknowledge.type='submit';acknowledge.id='incident-ack';
  const notify=button(ackActions,'Send an operator reminder',()=>perform('notify',()=>({expectedRevision:detail.incident.revision,expectedNotificationId:detail.latestNotificationId}),true));
  notify.id='incident-notify';
  const ackCopy=add(details,'p','','hint');
  add(details,'h3','Notification history');
  const queueHint=add(details,'p','Delivery attempts and accepted Slack receipts are retained by the original queue.','hint');
  const queueWrap=add(details,'div',undefined,'case-table-wrap'),queue=add(queueWrap,'table',undefined,'case-table incident-queue');
  queue.setAttribute('aria-label','Incident notification history');
  const queueHead=add(add(queue,'thead'),'tr');
  for(const text of ['Event / created','Delivery','Attempts / next try','Provider receipt','Action'])add(queueHead,'th',text).scope='col';
  const queueRows=add(queue,'tbody');

  const casePanel=add(details,'div',undefined,'incident-case-panel');
  add(casePanel,'h3','Continue in the merchant case');
  add(casePanel,'p','Prepare the incident’s original captures with the route and draft terms currently selected in this workspace. Review the handoff, then open it in Cases.');
  const routeLabel=add(casePanel,'label','Advertised route ID'),routeId=add(routeLabel,'input');routeId.id='incident-case-route';routeId.maxLength=80;routeId.required=true;routeId.autocomplete='off';
  const routeChoices=add(casePanel,'datalist');routeChoices.id='incident-route-choices';routeId.setAttribute('list',routeChoices.id);
  const captureStatus=add(casePanel,'p','','hint');
  const caseButtons=add(casePanel,'div',undefined,'actions');
  const prepare=button(caseButtons,'Prepare incident case',prepareCase,'');prepare.id='incident-case-prepare';
  const openCase=button(caseButtons,'Open prepared case',openPrepared);openCase.id='incident-case-open';
  const caseDownloads=add(casePanel,'div',undefined,'actions incident-downloads');
  const caseStatus=add(casePanel,'p','','hint');caseStatus.setAttribute('role','status');
  const technical=add(details,'details',undefined,'source-details');add(technical,'summary','Incident source and revision');
  const raw=add(technical,'pre');raw.tabIndex=0;

  const configPanel=add(root,'details',undefined,'source-details incident-config');
  add(configPanel,'summary','Watcher registration and notification settings');
  const configSummary=add(configPanel,'p','','hint');
  add(configPanel,'p','Edit the registered merchants, observation thresholds and notification destination. Existing queued messages retain their selected destination; an operator reminder selects the current destination.');
  const configForm=add(configPanel,'form');
  const configLabel=add(configForm,'label','Current watcher configuration'),configText=add(configLabel,'textarea');
  configText.id='incident-config-json';configText.rows=14;configText.spellcheck=false;configText.maxLength=60000;
  const configActions=add(configForm,'div',undefined,'actions');
  const saveConfig=add(configActions,'button','Apply configuration');saveConfig.type='submit';saveConfig.id='incident-config-save';
  const reloadConfig=button(configActions,'Reload current settings',()=>{configDirty=false;loadedConfigRevision=null;drawConfig();controls();});
  const verify=button(configActions,'Verify Slack workspace',()=>perform('destination',()=>({expectedConfigRevision:current.configRevision})));verify.id='incident-destination';
  const destinationStatus=add(configPanel,'p','','hint');destinationStatus.setAttribute('role','status');

  const base=()=>'/api/incidents/'+encodeURIComponent(source.value);
  const incidentRoute=action=>base()+'/'+encodeURIComponent(selectedId)+(action?'/'+action:'');
  const say=(text,error=false)=>{status.textContent=text;status.className=error?'status error':'status';};
  function clearPrepared(){prepared=null;caseDownloads.replaceChildren();for(const url of downloads)URL.revokeObjectURL(url);downloads.clear();caseStatus.textContent='';}
  async function api(path,payload) {
    const response=await fetch(path,{method:payload===undefined?'GET':'POST',credentials:'omit',cache:'no-store',signal:abort.signal,
      ...(payload===undefined?{}:{headers:{'content-type':'application/json'},body:JSON.stringify(payload)})});
    const data=await response.json();
    if(!response.ok)throw Object.assign(new Error(data.detail||data.error||'The incident operation could not complete.'),{code:data.error,status:response.status});
    return data;
  }
  function controls() {
    source.disabled=busy;search.disabled=busy;stateFilter.disabled=busy;merchant.disabled=busy;applyFilter.disabled=busy;
    refreshButton.disabled=busy||!source.value;previous.disabled=busy||offset===0;next.disabled=busy||!current?.page.hasMore;
    start.disabled=busy||!current?.worker.canStart;stop.disabled=busy||!current?.worker.canStop;
    acknowledge.disabled=busy||detail?.incident.status!=='OPEN';notify.disabled=busy||!detail;
    operator.disabled=busy;notes.disabled=busy||detail?.incident.status!=='OPEN';routeId.disabled=busy;
    prepare.disabled=busy||!detail||!detail.incident.beforeCapture&&!detail.incident.afterCapture;
    openCase.disabled=busy||!prepared;closeDetail.disabled=busy;
    configText.disabled=busy||!current;saveConfig.disabled=busy||!current||loadedConfigRevision===null||!configDirty;reloadConfig.disabled=busy||!current;
    verify.disabled=busy||current?.config.notification?.transport!=='slack';
    for(const node of queueRows.querySelectorAll('button'))node.disabled=busy||!operator.value.trim();
  }
  function drawConfig() {
    if(!current)return;
    if(!configDirty&&loadedConfigRevision!==current.configRevision) {
      configText.value=JSON.stringify(current.config,null,2);loadedConfigRevision=current.configRevision;
    }
    configSummary.textContent='Loaded revision '+loadedConfigRevision+' · current revision '+current.configRevision+
      (configDirty?' · unsaved edits':'')+(configDirty&&loadedConfigRevision!==current.configRevision?' · reload current settings before applying a new edit.':'');
  }
  function drawList() {
    listRows.replaceChildren();if(!current)return;
    for(const item of current.incidents) {
      const row=add(listRows,'tr');row.setAttribute('aria-selected',String(item.id===selectedId));
      const cell=add(row,'td');button(cell,item.merchantLabel||current.merchants.find(m=>m.id===item.merchantId)?.label||item.merchantId,()=>selectIncident(item.id),'case-link');
      add(cell,'small',labels[item.kind]||human(item.kind));
      add(row,'td',human(item.status));add(row,'td',when(item.openedAt));add(row,'td',when(item.lastObservedAt));
      add(row,'td',human(item.notificationState));
    }
    if(!current.incidents.length)add(add(listRows,'tr'),'td','No incidents match these filters.').colSpan=5;
    count.textContent=current.page.total+' incidents'+(current.page.total?' · '+(current.page.offset+1)+'–'+(current.page.offset+current.incidents.length):'');
    counters.replaceChildren();
    for(const [key,title] of [['open','Open'],['acknowledged','Acknowledged'],['pendingNotifications','Queued deliveries'],['pausedNotifications','Paused'],['exhaustedNotifications','Needs delivery attention']]) {
      const card=add(counters,'div');add(card,'strong',String(current.counters[key]??0));add(card,'span',title);
    }
    const worker=current.worker;
    workerState.textContent=(worker.ownership==='console'?'This console · ':worker.ownership==='external'?'Recorded external service · ':'')+human(worker.status);
    workerObserved.textContent='Last sweep: '+when(worker.recorded?.lastSweepAt)+(worker.error?' · '+human(worker.error):'');
    badge.textContent=current.source.label;drawConfig();controls();
  }
  function fact(label,value){const row=add(facts,'div',undefined,'scope-row');add(row,'b',label);add(row,'span',String(value??'—'));}
  function drawDetail() {
    details.hidden=!detail;if(!detail){controls();return;}
    const incident=detail.incident;
    routeChoices.replaceChildren();
    for(const choice of detail.routes??[]){const option=add(routeChoices,'option');option.value=choice.id;option.label=choice.method+' '+(choice.path??'')+' · '+choice.sides.join(' and ');}
    captureStatus.textContent=Object.entries(detail.captureProblems??{}).map(([side,problem])=>human(side)+' capture: '+problem.detail).join(' ');
    captureStatus.classList.toggle('error',Boolean(captureStatus.textContent));
    if(!captureStatus.textContent)captureStatus.textContent=(detail.routes??[]).map(choice=>choice.id+' · '+choice.method+' '+(choice.path??'')+' · '+choice.sides.join(' and ')).join('; ');
    detailTitle.textContent=(incident.merchantLabel||incident.merchantId)+' · '+(labels[incident.kind]||human(incident.kind));
    detailIdentity.textContent='Incident '+incident.id+' · revision '+incident.revision;
    facts.replaceChildren();fact('State',human(incident.status));fact('Opened',when(incident.openedAt));
    fact('Last observation',when(incident.lastObservedAt));fact('Closed',when(incident.closedAt));
    fact('Before capture',incident.beforeCapture?'Available':'Not captured');fact('After capture',incident.afterCapture?'Available':'Not captured');
    ackCopy.textContent=incident.acknowledgment?'Acknowledged by '+incident.acknowledgment.by+' at '+when(incident.acknowledgment.at)+
      (incident.acknowledgment.notes?' · '+incident.acknowledgment.notes:''):'Record who is taking care of this incident.';
    queueRows.replaceChildren();
    for(const event of [...detail.notifications].reverse()) {
      const row=add(queueRows,'tr'),first=add(row,'td');add(first,'strong',human(event.transition));add(first,'small',when(event.createdAt));
      const delivery=add(row,'td');add(delivery,'span',human(event.status));if(event.lastReason)add(delivery,'small',human(event.lastReason));
      const attempt=add(row,'td');add(attempt,'span',event.attempts+' / '+event.attemptLimit);add(attempt,'small',event.nextAttemptAt?when(event.nextAttemptAt):'—');
      const receiptCell=add(row,'td'),receipt=event.providerReceipt;
      if(receipt?.transport==='slack') {
        const link=add(receiptCell,'a','Open Slack channel');
        link.href='https://slack.com/app_redirect?'+new URLSearchParams({team:receipt.teamId,channel:receipt.channelId});link.target='_blank';link.rel='noopener noreferrer';
        add(receiptCell,'small','Message '+receipt.messageTs);add(receiptCell,'small','Thread '+receipt.threadTs);
      } else add(receiptCell,'span',event.acceptedAt?'Accepted '+when(event.acceptedAt):'—');
      const actions=add(row,'td');
      if(['PAUSED','EXHAUSTED'].includes(event.status))button(actions,'Retry delivery',()=>queueAction(event,'retry'),'text-button');
      if(!terminal.has(event.status)&&event.status!=='IN_FLIGHT')button(actions,'Cancel delivery',()=>queueAction(event,'cancel'),'text-button');
      if(!actions.childElementCount)add(actions,'span','—');
    }
    if(!detail.notifications.length)add(add(queueRows,'tr'),'td','No notification has been queued for this incident.').colSpan=5;
    raw.textContent=JSON.stringify({incident,notifications:detail.notifications},null,2);controls();
  }
  function schedule() {
    clearTimeout(timer);
    if(!destroyed&&!document.hidden&&live.checked&&current&&
      (['STARTING','RUNNING','STOPPING'].includes(current.worker.status)||current.counters.pendingNotifications>0))
      timer=setTimeout(()=>refresh(),5000);
  }
  async function refresh({force=false}={}) {
    if(destroyed||!source.value||busy&&!force)return;
    const stamp=++sequence,epoch=selection,profile=source.value,incident=selectedId;
    const query=new URLSearchParams({offset:String(offset),limit:'20'});
    for(const [key,value] of [['q',search.value.trim()],['status',stateFilter.value],['merchant',merchant.value]])if(value)query.set(key,value);
    try {
      const [list,value]=await Promise.all([api('/api/incidents/'+encodeURIComponent(profile)+'?'+query),
        incident?api('/api/incidents/'+encodeURIComponent(profile)+'/'+encodeURIComponent(incident)).catch(error=>{if(error.status===404)return null;throw error;}):Promise.resolve(null)]);
      if(destroyed||stamp!==sequence||epoch!==selection)return;
      current=list;detail=value;
      if(incident&&!value){selectedId=null;clearPrepared();say('The selected incident was removed by retention. The current queue is shown.');}
      const selectedMerchant=merchant.value;merchant.replaceChildren();add(merchant,'option','All merchants').value='';
      for(const row of list.merchants)add(merchant,'option',row.label).value=row.id;
      merchant.value=list.merchants.some(m=>m.id===selectedMerchant)?selectedMerchant:'';
      drawList();drawDetail();schedule();
    } catch(error){if(!destroyed&&stamp===sequence){say(error.message,true);controls();schedule();}}
  }
  async function selectIncident(id) {
    if(busy)return;selection++;selectedId=id;detail=null;notes.value='';routeId.value='';clearPrepared();drawDetail();drawList();
    await refresh();
  }
  async function perform(action,payload,forIncident=false) {
    if(busy||!current||forIncident&&!detail)return;
    busy=true;sequence++;clearTimeout(timer);controls();
    try {
      const result=await api(forIncident?incidentRoute(action):base()+'/'+action,payload());
      if(action==='destination') {
        destinationStatus.textContent=result.accepted?'Verified workspace '+result.teamId+' · actor '+result.actorId+' · channel '+result.channelId:human(result.reason);
        say(result.accepted?'Slack workspace and actor verified.':'Slack verification needs attention.',!result.accepted);
      } else {
        if(action==='configure'){configDirty=false;loadedConfigRevision=null;destinationStatus.textContent='';}
        if(action==='ack')notes.value='';
        say(action==='start'?'Watcher start requested. Its state appears above.':action==='stop'?'This console’s watcher stopped and drained.':
          action==='configure'?'Watcher configuration applied.':action==='ack'?'Incident acknowledged.':action==='notify'?'Operator reminder queued.':'Operation completed.');
      }
      await refresh({force:true});
    } catch(error){say(error.message,true);await refresh({force:true});}
    finally {busy=false;controls();schedule();}
  }
  async function queueAction(event,action) {
    if(busy||!operator.reportValidity())return;
    busy=true;sequence++;clearTimeout(timer);controls();
    try {
      await api(base()+'/notifications/'+encodeURIComponent(event.id)+'/'+action,{expectedAttempts:event.attempts,by:operator.value.trim()});
      say(action==='retry'?'The original delivery is queued to retry.':'The selected delivery was cancelled.');
      await refresh({force:true});
    } catch(error){say(error.message,true);await refresh({force:true});}
    finally {busy=false;controls();schedule();}
  }
  async function prepareCase() {
    if(busy||!detail||!routeId.reportValidity())return;
    busy=true;sequence++;clearTimeout(timer);controls();clearPrepared();
    try {
      const snapshot=await exportCase();
      const value=await api(incidentRoute('case'),{expectedRevision:detail.incident.revision,workspaceText:snapshot.workspaceText,routeId:routeId.value.trim()});
      prepared=value;
      const name='incident-'+detail.incident.id;
      for(const [text,body,file,type] of [['Download handoff',value.handoff,name+'-support.json','application/json'],['Download readable review',value.html,name+'-support.html','text/html']]) {
        const url=URL.createObjectURL(new Blob([body],{type}));downloads.add(url);
        const link=add(caseDownloads,'a',text);link.href=url;link.download=file;
      }
      caseStatus.textContent=value.report?.comparison?.detail||'Original incident captures are ready to open in Cases.';
      say('Incident case prepared from the retained original captures.');
    } catch(error){say(error.message,true);}
    finally {busy=false;controls();schedule();}
  }
  async function openPrepared() {
    if(busy||!prepared)return;busy=true;controls();
    try {
      const original=JSON.parse(prepared.handoff),state=await parseWorkspace(original.workspaceText);
      const opened=await importCase(state,{supportText:original.supportText,metadata:original.metadata});
      say(opened?'Incident captures opened in Cases. Save the case to retain your continued work.':'The prepared incident handoff remains available.');
      if(opened)document.getElementById('cases')?.scrollIntoView({block:'start'});
    } catch(error){say(error.message,true);}finally{busy=false;controls();}
  }
  selectionForm.addEventListener('submit',event=>{event.preventDefault();if(busy)return;offset=0;refresh();},{signal:abort.signal});
  source.addEventListener('change',()=>{selection++;sequence++;offset=0;selectedId=null;current=null;detail=null;configDirty=false;loadedConfigRevision=null;
    destinationStatus.textContent='';merchant.value='';routeId.value='';configText.value='';configSummary.textContent='Loading settings…';listRows.replaceChildren();
    clearPrepared();drawDetail();refresh();},{signal:abort.signal});
  operator.addEventListener('input',controls,{signal:abort.signal});
  routeId.addEventListener('input',()=>{clearPrepared();controls();},{signal:abort.signal});
  acknowledgeForm.addEventListener('submit',event=>{event.preventDefault();if(!acknowledgeForm.reportValidity())return;
    perform('ack',()=>({expectedRevision:detail.incident.revision,by:operator.value.trim(),notes:notes.value}),true);},{signal:abort.signal});
  configText.addEventListener('input',()=>{configDirty=true;drawConfig();controls();},{signal:abort.signal});
  configForm.addEventListener('submit',event=>{event.preventDefault();let config;
    try{config=JSON.parse(configText.value);}catch{say('Enter valid configuration JSON before applying settings.',true);return;}
    perform('configure',()=>({config,expectedConfigRevision:loadedConfigRevision}));},{signal:abort.signal});
  document.addEventListener('visibilitychange',()=>{if(document.hidden)clearTimeout(timer);else refresh();},{signal:abort.signal});
  api('/api/incidents/profiles').then(data=>{
    if(destroyed||data.enabled===false||!data.sources?.length)return;
    for(const row of data.sources)add(source,'option',row.label).value=row.id;
    root.hidden=false;const navigation=document.querySelector('[data-incident-navigation]');
    if(navigation){navigation.hidden=false;navigation.closest('.workflow').classList.add('has-incidents');}
    say('Choose an incident to review, or operate the selected watcher.');refresh();
  }).catch(error=>{if(!destroyed){root.hidden=false;say(error.message,true);}});
  return {destroy(){destroyed=true;clearTimeout(timer);clearPrepared();abort.abort();root.replaceChildren();}};
}
