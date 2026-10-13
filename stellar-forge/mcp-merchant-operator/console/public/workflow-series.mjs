// MIT. Recurring customer tasks in the original merchant Workflows page.
export function createWorkflowSeries({state,$,node,text,pretty,when,tag,properties,selectionList,action,busy,api,notice,
  uid,requireProfile,context,current,intentRecord,markAttempt,releaseIntent,mutate,mutationActive,
  openRun,getSelection,getDefinitions,download,schedulePoll}) {
  const kinds=['series-save','series-cycle-save','series-cycle-start','series-cycle-cancel'];
  const routes={'series-save':'workflow-series-save','series-cycle-save':'workflow-cycle-save',
    'series-cycle-start':'workflow-cycle-start','series-cycle-cancel':'workflow-cycle-cancel'};
  const own={profileId:null,session:null,list:[],selected:null,id:null,dirty:false,version:0,selection:0,refresh:0,
    page:null,offset:0,cycle:null,cycleVersion:0,cycleSelection:0,review:null,pending:[],ready:false,lastRefresh:0,calendar:null,
    agenda:null,agendaEpoch:0,agendaLoading:false};
  const order=value=>Array.isArray(value)?value.map(order):value&&typeof value==='object'?
    Object.fromEntries(Object.keys(value).sort().map(key=>[key,order(value[key])])):value;
  const same=(a,b)=>JSON.stringify(order(a))===JSON.stringify(order(b));
  const invoke=(route,body,ctx)=>api(route,{method:'POST',body,epoch:ctx.session});
  const isSaved=()=>Boolean(own.selected)&&!own.dirty;
  function parse(value,label,array=false){
    let result;try{result=JSON.parse(value);}catch(error){throw new Error(label+' must be complete JSON: '+error.message);}
    if(array?!Array.isArray(result):!result||typeof result!=='object'||Array.isArray(result))
      throw new Error(label+' must be a JSON '+(array?'array':'object')+'.');
    return result;
  }
  function invalidateReview(){own.review=null;$('series-review').hidden=true;sync();}
  function changed(){own.dirty=true;own.version++;invalidateReview();}
  function cycleChanged(){own.cycleVersion++;invalidateReview();}
  function reset(){
    own.profileId=state.profile?.id??null;own.session=state.sessionEpoch;own.version++;own.selection++;
    own.refresh++;own.cycleVersion++;own.cycleSelection++;own.list=[];own.selected=null;own.id=null;
    own.dirty=false;own.page=null;own.offset=0;own.cycle=null;own.review=null;own.pending=[];own.ready=false;
    own.lastRefresh=0;own.calendar=null;own.agenda=null;own.agendaEpoch++;own.agendaLoading=false;
    resetAgenda();
    for(const id of ['series-editor','series-work','series-cycle-editor','series-review','series-cycle-detail','series-pending'])$(id).hidden=true;
    for(const id of ['series-calendar-list','series-cycles','series-pending-list'])$(id).replaceChildren();
    renderList();sync();
  }
  function profileChanged(){
    if(own.profileId!==(state.profile?.id??null)||own.session!==state.sessionEpoch)reset();
    workflowChoices();sync();
  }
  function workflowChoices(){
    const selected=$('series-workflow').value|| (own.selected?own.selected.workflowId+'@'+own.selected.workflowRevision:'');
    const values=getDefinitions().map(value=>({id:value.id,revision:value.revision,name:value.name}));
    if(own.selected&&!values.some(value=>value.id===own.selected.workflowId&&value.revision===own.selected.workflowRevision))
      values.unshift({id:own.selected.workflowId,revision:own.selected.workflowRevision,name:'Selected original workflow'});
    $('series-workflow').replaceChildren(new Option('Choose a complete saved workflow',''),
      ...values.map(value=>new Option(value.name+' · r'+value.revision,value.id+'@'+value.revision)));
    if(values.some(value=>value.id+'@'+value.revision===selected))$('series-workflow').value=selected;
  }
  function editor(value=null){
    requireProfile();own.selection++;own.version++;own.cycleVersion++;own.cycleSelection++;
    own.selected=value;own.id=value?.id??uid();own.dirty=!value;own.cycle=null;own.review=null;own.calendar=null;
    own.offset=0;own.page=null;
    $('series-editor').hidden=false;$('series-work').hidden=!value;
    for(const id of ['series-cycle-editor','series-review','series-cycle-detail'])$(id).hidden=true;
    $('series-calendar-list').replaceChildren();$('series-calendar-next').hidden=true;
    for(const [id,field] of [['series-name','name'],['series-customer','customer'],['series-task','task']])$(id).value=value?.[field]??'';
    const selection=getSelection();
    let inputs=value?.baseInputs;
    if(!value){try{inputs=parse(selection.inputsText||'{}','Selected workflow inputs');}catch{inputs={};}}
    $('series-base-inputs').value=pretty(inputs??{});$('series-bindings').value=pretty(value?.cycleBindings??[]);
    $('series-enabled').checked=value?.enabled??true;
    $('series-cadence').value=value?.cadence.unit??'manual';
    $('series-interval').value=String(value?.cadence.interval??1);
    $('series-anchor').value=value?.cadence.anchorDate??'';
    workflowChoices();
    if(!value&&selection.id&&!selection.dirty)$('series-workflow').value=selection.id+'@'+selection.revision;
    const today=new Date().toISOString().slice(0,10),later=new Date(Date.now()+93*86400000).toISOString().slice(0,10);
    $('series-calendar-from').value=today;$('series-calendar-to').value=later;
    renderList();renderCycles();sync();
    if(!value)$('series-name').focus();
  }
  async function openSeries(id,{offset=0,revision}={}){
    requireProfile();const ctx=context(),seq=++own.selection,version=own.version;
    const query=new URLSearchParams({offset:String(offset),limit:'50'});if(revision)query.set('revision',String(revision));
    const packet=await api('workflow-series/'+encodeURIComponent(id)+'?'+query,{epoch:ctx.session});
    if(!current(ctx)||seq!==own.selection||version!==own.version)return;
    editor(packet.series);own.page=packet;own.offset=offset;renderCycles();sync();
  }
  function renderList(){
    selectionList($('series-list'),own.list,own.selected?.id,(button,value)=>{
      button.append(node('strong',value.name),node('p',value.customer+' · '+value.complete+' / '+value.cycles+' periods complete'));
      const meta=node('div',undefined,'meta');meta.append(tag(value.enabled?'ENABLED':'PAUSED'));
      if(value.nextDue)meta.append(node('span','Next pending due '+value.nextDue));
      button.append(meta);
    },value=>openSeries(value.id),state.profile?'Save the complete customer task to reuse it for another period.':'Select or create a profile.');
  }
  function renderCycles(){
    const page=own.page,cycles=page?.cycles??[];
    selectionList($('series-cycles'),cycles,own.cycle?.cycle.id,(button,value)=>{
      button.append(node('strong',value.label),node('p',value.period.start+' to '+value.period.end+' · due '+value.dueDate));
      const meta=node('div',undefined,'meta');meta.append(tag(value.state),node('span',value.stepsComplete+' / '+value.stepCount+' native steps'));
      button.append(meta,node('p',value.sourceEdition||value.key,'hint break'));
    },value=>openCycle(value.id),'No saved periods in this page.');
    const previous=$('series-previous-cycle').value;
    $('series-previous-cycle').replaceChildren(new Option('No earlier cycle selected',''),
      ...cycles.map(value=>new Option(value.label+' · '+value.key,value.id)));
    if(cycles.some(value=>value.id===previous))$('series-previous-cycle').value=previous;
    $('series-cycles-previous').disabled=!page||own.offset===0;
    $('series-cycles-next').disabled=!page||page.nextOffset===null;
  }
  async function restorePending(ctx=context()){
    const values=await Promise.all(kinds.map(kind=>intentRecord(ctx,kind)));
    if(!current(ctx))return;own.pending=values.filter(Boolean);own.ready=true;renderPending();sync();
  }
  function saveJson(value,name){
    const href=URL.createObjectURL(new Blob([pretty(value)+'\n'],{type:'application/json'})),a=node('a');
    a.href=href;a.download=name;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(href),1000);
  }
  function renderPending(){
    $('series-pending').hidden=!own.pending.length;
    $('series-pending-list').replaceChildren(...own.pending.map(value=>{
      const box=node('section',undefined,'subsection'),label=value.kind.replaceAll('-',' ');
      box.append(node('h5',label),node('p','Saved '+when(value.createdAt)+' · '+value.attempts+' dispatch attempt(s)','hint'));
      const buttons=node('div',undefined,'actions'),retry=node('button','Continue original action'),exported=node('button','Download original request');
      retry.type=exported.type='button';retry.dataset.seriesRetry='true';retry.disabled=mutationActive()||!own.ready||Boolean(state.host?.console.closing);
      action(retry,()=>mutate(()=>submitIntent(value.kind,value.body,true)));
      action(exported,()=>saveJson({schema:'stellar-forge.workflow-series-browser-intent.v1',...value},value.kind+'-original.json'));
      buttons.append(retry,exported);box.append(buttons);return box;
    }));
  }
  async function submitIntent(kind,body,recover=false){
    requireProfile();const ctx=context();
    if(!own.ready)throw new Error('Let the original pending actions load first.');
    const retained=await intentRecord(ctx,kind,old=>old??{kind,route:routes[kind],body,attempts:0,createdAt:new Date().toISOString()});
    await restorePending(ctx);if(!current(ctx))return;
    if(!same(retained.body,body))throw new Error('Continue the displayed original '+kind+' before creating another action of this kind.');
    const attempt=await markAttempt(ctx,kind,body);if(!current(ctx))return;
    let packet;
    try{packet=await invoke(routes[kind],body,ctx);}
    catch(error){
      const definitiveConflict=['CONSOLE_SERIES_REVISION_CONFLICT','CONSOLE_CYCLE_REVIEW_CHANGED',
        'CONSOLE_CYCLE_CONFLICT','CONSOLE_CYCLE_STARTED','CONSOLE_CYCLE_CANCEL_CONFLICT','CONSOLE_SERIES_REQUEST_CONFLICT'].includes(error.code);
      if((!attempt.prior&&error.status>=400&&error.status<500)||definitiveConflict)
        await releaseIntent(ctx,kind,body,attempt);
      if(current(ctx)){await restorePending(ctx);invalidateReview();}
      throw error;
    }
    await releaseIntent(ctx,kind,body);if(!current(ctx))return;
    await restorePending(ctx);
    if(kind==='series-save')await openSeries(packet.series.id);
    else {
      if(own.selected?.id!==packet.cycle.seriesId)await openSeries(packet.cycle.seriesId);
      if(current(ctx))await openCycle(packet.cycle.id);
      if(kind==='series-cycle-start'&&packet.run&&current(ctx)){await openRun(packet.run.id);schedulePoll();}
    }
    if(current(ctx)){await refresh(true);notice((packet.reused?'Reopened the original action. ':'Saved. ')+
      (kind==='series-cycle-save'?'The complete period is ready for its first-start review.':
        kind==='series-cycle-start'?'The original native run retains its progress and receiving controls.':
        kind==='series-cycle-cancel'?'The planned period is canceled.':'The customer task is available for the next period.'));}
    return packet;
  }
  function seriesBody(){
    const chosen=$('series-workflow').value,split=chosen.lastIndexOf('@');
    if(split<1)throw new Error('Choose a complete saved workflow.');
    const unit=$('series-cadence').value;
    return {requestId:uid(),id:own.id,profileId:requireProfile().id,expectedRevision:own.selected?.revision??0,
      name:$('series-name').value,customer:$('series-customer').value,task:$('series-task').value,
      workflowId:chosen.slice(0,split),workflowRevision:Number(chosen.slice(split+1)),
      baseInputs:parse($('series-base-inputs').value,'Default inputs'),
      cycleBindings:parse($('series-bindings').value,'Cycle input bindings',true),
      cadence:unit==='manual'?{unit}:{unit,interval:Number($('series-interval').value),anchorDate:$('series-anchor').value},
      enabled:$('series-enabled').checked};
  }
  function newCycle(period=null){
    if(!isSaved())throw new Error('Save this customer series edition first.');
    own.cycleVersion++;own.cycleSelection++;own.review=null;own.cycle=null;
    $('series-cycle-editor').hidden=false;$('series-cycle-detail').hidden=true;$('series-review').hidden=true;
    const today=new Date().toISOString().slice(0,10);
    $('series-cycle-key').value=period?.key??'';$('series-cycle-label').value=period?.label??'';
    $('series-period-start').value=period?.period.start??today;$('series-period-end').value=period?.period.end??today;
    $('series-due-date').value=period?.dueDate??today;$('series-source-edition').value='';
    $('series-cycle-reason').value='';$('series-previous-cycle').value='';
    $('series-cycle-inputs').value=pretty(own.selected.baseInputs);sync();$('series-cycle-key').focus();
  }
  function cycleBody(){
    if(!isSaved())throw new Error('Save this customer series edition first.');
    return {seriesId:own.selected.id,seriesRevision:own.selected.revision,key:$('series-cycle-key').value,
      label:$('series-cycle-label').value,period:{start:$('series-period-start').value,end:$('series-period-end').value},
      dueDate:$('series-due-date').value,sourceEdition:$('series-source-edition').value,reason:$('series-cycle-reason').value,
      previousCycleId:$('series-previous-cycle').value||null,inputs:parse($('series-cycle-inputs').value,'Complete cycle inputs')};
  }
  async function reviewCycle(){
    const ctx=context(),version=own.cycleVersion,selection=own.selection,request=cycleBody();
    const packet=await invoke('workflow-cycle-review',request,ctx);
    if(!current(ctx)||version!==own.cycleVersion||selection!==own.selection)return;
    own.review={kind:'cycle',packet,ctx,version,selection};renderReview();sync();
  }
  function renderReview(){
    const selected=own.review;$('series-review').hidden=!selected;if(!selected)return;
    const {review,request}=selected.packet;
    text($('series-review-title'),selected.kind==='start'?'Review the first start on this host':'Review the complete customer period');
    properties($('series-review-properties'),[
      ['Series',own.selected?.name??review.seriesId],['Work period',review.request.period.start+' to '+review.request.period.end],
      ['Due',review.request.dueDate],['Source edition',review.request.sourceEdition||'No separate source edition selected'],
      ['Reason',review.request.reason],['Native workflow',review.workflowId+' / r'+review.workflowRevision,true],
      ['Original run',review.runId,true],['Current host',review.hostFingerprint,true]
    ]);
    $('series-review-issues').replaceChildren(...review.issues.map(value=>node('p',value.message,'notice')));
    $('series-review-steps').replaceChildren(...review.steps.map((step,index)=>{
      const row=node('tr');row.append(node('td',String(index+1)+' · '+step.name),node('td',step.tool),
        node('td',step.pauseAfter?'Operator continues after review':'Continue saved steps'));return row;
    }));
    text($('series-review-json'),pretty({request:request??review.request,review}));
    $('series-cycle-save').hidden=selected.kind!=='cycle';$('series-cycle-start').hidden=selected.kind!=='start';
  }
  async function saveReviewed(){
    const selected=own.review;
    if(!selected||selected.kind!=='cycle'||!selected.packet.review.canStart||!current(selected.ctx)||
      selected.version!==own.cycleVersion||selected.selection!==own.selection)throw new Error('Review the complete current period first.');
    return submitIntent('series-cycle-save',{request:selected.packet.request,expectedReviewSha256:selected.packet.review.contentSha256});
  }
  async function openCycle(id,{background=false}={}){
    const ctx=context(),seq=background?own.cycleSelection:++own.cycleSelection,selection=own.selection;
    const packet=await api('workflow-cycle/'+encodeURIComponent(id),{epoch:ctx.session});
    if(!current(ctx)||seq!==own.cycleSelection||selection!==own.selection||background&&own.cycle?.cycle.id!==id)return;
    own.cycle=packet;
    if(!background){own.cycleVersion++;own.review=null;$('series-review').hidden=true;$('series-cycle-editor').hidden=true;}
    renderCycle();renderCycles();sync();
  }
  function renderCycle(){
    const packet=own.cycle;$('series-cycle-detail').hidden=!packet;if(!packet)return;
    const {cycle,status,run}=packet,request=cycle.request;
    text($('series-cycle-title'),request.label);
    properties($('series-cycle-properties'),[
      ['Status',status.state],['Complete period',request.period.start+' to '+request.period.end],['Due',request.dueDate],
      ['Source edition',request.sourceEdition||'No separate source edition selected'],['Customer',packet.series.customer],
      ['Reason',request.reason],['Series edition',String(cycle.seriesRevision)],['Original period',cycle.id,true],
      ['Original native run',cycle.runId,true],['Progress',status.stepsComplete+' / '+status.stepCount+' native steps']
    ]);
    text($('series-cycle-message'),packet.cancellation?packet.cancellation.reason:run?
      'Open the original run for native results, pause, recovery, handover and complete customer receiving.':
      'This complete period is saved. Review its first start on the current host when ready.');
    text($('series-cycle-json'),pretty(packet));
    $('series-open-run').hidden=!run;$('series-cycle-start-review').hidden=Boolean(run||packet.cancellation);
    $('series-cycle-cancel-form').hidden=Boolean(run||packet.cancellation);
  }
  async function startReview(){
    if(!own.cycle)throw new Error('Open a saved customer period.');
    const ctx=context(),version=own.cycleVersion,selection=own.selection,id=own.cycle.cycle.id;
    const packet=await invoke('workflow-cycle-start-review',{id},ctx);
    if(!current(ctx)||version!==own.cycleVersion||selection!==own.selection||own.cycle?.cycle.id!==id)return;
    if(packet.reused){own.cycle=packet;renderCycle();sync();return openRun(packet.run.id);}
    own.review={kind:'start',packet,ctx,version,selection};renderReview();sync();
  }
  async function startReviewed(){
    const selected=own.review;
    if(!selected||selected.kind!=='start'||!selected.packet.review.canStart||!current(selected.ctx)||
      selected.version!==own.cycleVersion||selected.selection!==own.selection)throw new Error('Review this original period on the current host first.');
    return submitIntent('series-cycle-start',{id:selected.packet.cycle.id,expectedReviewSha256:selected.packet.review.contentSha256});
  }
  async function calendar(next=false){
    if(!isSaved())throw new Error('Save the selected customer series first.');
    const ctx=context(),selection=own.selection,version=own.version;
    const request={id:own.selected.id,revision:own.selected.revision,
      from:next?own.calendar?.nextFrom:$('series-calendar-from').value,to:$('series-calendar-to').value,limit:120};
    if(!request.from)throw new Error('Select a calendar window.');
    const packet=await invoke('workflow-series-calendar',request,ctx);
    if(!current(ctx)||selection!==own.selection||version!==own.version)return;
    own.calendar=packet;
    selectionList($('series-calendar-list'),packet.periods,null,(button,value)=>{
      button.append(node('strong',value.label),node('p',value.existing?'Original period · '+value.existing.state:'Due '+value.dueDate+' · select actual source and inputs'));
    },value=>value.existing?openCycle(value.existing.id):newCycle(value),
      packet.manual?'This series selects each period explicitly. Use New period or source edition.':'No periods overlap this calendar window.');
    $('series-calendar-next').hidden=!packet.nextFrom;
  }
  function localDay(value=new Date()){
    return String(value.getFullYear()).padStart(4,'0')+'-'+String(value.getMonth()+1).padStart(2,'0')+'-'+String(value.getDate()).padStart(2,'0');
  }
  function resetAgenda(){
    const date=new Date(),later=new Date(date.getFullYear(),date.getMonth(),date.getDate()+30);
    $('series-agenda-from').value=localDay(date);$('series-agenda-to').value=localDay(later);
    $('series-agenda-today').value=localDay(date);$('series-agenda-query').value='';
    $('series-agenda-status').value='open';$('series-agenda-overdue').checked=true;$('series-agenda-proposed').checked=true;
    renderAgenda();
  }
  function agendaRequest(offset=0){
    return {profileId:requireProfile().id,from:$('series-agenda-from').value,to:$('series-agenda-to').value,
      today:$('series-agenda-today').value,query:$('series-agenda-query').value,status:$('series-agenda-status').value,
      includeOverdue:$('series-agenda-overdue').checked,includeProposed:$('series-agenda-proposed').checked,offset,limit:50};
  }
  function agendaChanged(){
    own.agendaEpoch++;own.agenda=null;own.agendaLoading=false;renderAgenda();sync();
  }
  async function loadAgenda(offset=0){
    const request=agendaRequest(offset),ctx=context(),epoch=++own.agendaEpoch;
    own.agendaLoading=true;sync();
    try{
      const packet=await invoke('workflow-series-agenda',request,ctx);
      if(!current(ctx)||epoch!==own.agendaEpoch)return;
      own.agenda=packet;renderAgenda();
    }finally{if(current(ctx)&&epoch===own.agendaEpoch){own.agendaLoading=false;sync();}}
  }
  async function openAgendaItem(item){
    const ctx=context();
    await openSeries(item.seriesId,{revision:item.seriesRevision});
    if(!current(ctx)||own.selected?.id!==item.seriesId||own.selected.revision!==item.seriesRevision)return;
    if(item.kind==='saved'){
      await openCycle(item.id);
      if(current(ctx))$('series-cycle-detail').scrollIntoView({block:'start'});
    }else{
      newCycle(item);$('series-cycle-editor').scrollIntoView({block:'start'});
    }
  }
  function renderAgenda(){
    const packet=own.agenda,body=$('series-agenda-rows');
    body.replaceChildren();
    if(!packet){
      text($('series-agenda-summary'),'Choose a due-date window and open the delivery agenda.');
      text($('series-agenda-page'),'');
      const row=node('tr'),cell=node('td','Customer periods appear here.','empty');cell.colSpan=5;row.append(cell);body.append(row);return;
    }
    const counts=packet.counts;
    text($('series-agenda-summary'),counts.total+' periods · '+counts.overdue+' overdue · '+counts.today+
      ' due today · '+counts.proposed+' to plan · '+counts.attention+' awaiting attention · updated '+when(packet.generatedAt));
    for(const item of packet.items){
      const row=node('tr'),due=node('td'),work=node('td'),status=node('td'),source=node('td'),controls=node('td');
      due.append(node('strong',item.dueDate),node('p',item.dueGroup==='today'?'Due today':item.dueGroup,'hint'));
      work.append(node('strong',item.customer),node('p',item.seriesName),node('p',item.label,'hint'),
        node('p',item.period.start+' to '+item.period.end,'hint'));
      status.append(tag(item.state));
      if(item.stepCount!==null)status.append(node('p',item.stepsComplete+' / '+item.stepCount+' steps','hint'));
      if(!item.seriesEnabled)status.append(node('p','New work paused','hint'));
      source.append(node('p',item.sourceEdition|| (item.kind==='proposed'?'Select the source for this period':'Source retained in original inputs'),'break'));
      const open=node('button',item.kind==='proposed'?'Plan period':'Open period');open.type='button';
      open.disabled=mutationActive();action(open,()=>openAgendaItem(item));controls.append(open,node('p',item.nextAction,'hint'));
      row.append(due,work,status,source,controls);body.append(row);
    }
    if(!packet.items.length){
      const row=node('tr'),cell=node('td',packet.total?'This page moved. Return to the first page.':'No customer periods match these dates and filters.','empty');
      cell.colSpan=5;row.append(cell);body.append(row);
    }
    text($('series-agenda-page'),packet.total?'Showing '+(packet.items.length?packet.offset+1:0)+'–'+
      (packet.offset+packet.items.length)+' of '+packet.total:'0 periods');
  }
  async function exportAgenda(){
    const ctx=context(),request=agendaRequest(),epoch=own.agendaEpoch;
    const packet=await invoke('workflow-series-agenda-calendar',request,ctx);
    if(!current(ctx)||epoch!==own.agendaEpoch)return;
    const href=URL.createObjectURL(new Blob([packet.content],{type:packet.mediaType})),link=node('a');
    link.href=href;link.download=packet.filename;document.body.append(link);link.click();link.remove();
    setTimeout(()=>URL.revokeObjectURL(href),1000);
    notice('Downloaded '+packet.events+' customer deadlines for the complete selected agenda.');
  }
  async function refresh(force=false){
    profileChanged();const ctx=context();if(!ctx.profileId)return;
    if(!force&&Date.now()-own.lastRefresh<7000)return;
    own.lastRefresh=Date.now();const seq=++own.refresh;
    try{await restorePending(ctx);}catch(error){if(current(ctx)){own.ready=false;notice('The original series actions could not be opened: '+error.message,true);}}
    const packet=await api('workflow-series?'+new URLSearchParams({profile:ctx.profileId}),{epoch:ctx.session});
    if(!current(ctx)||seq!==own.refresh)return;
    own.list=packet.series;renderList();workflowChoices();
    if(own.selected){
      const id=own.selected.id,selection=own.selection;
      const page=await api('workflow-series/'+encodeURIComponent(id)+'?'+new URLSearchParams({revision:String(own.selected.revision),offset:String(own.offset),limit:'50'}),{epoch:ctx.session});
      if(!current(ctx)||seq!==own.refresh||selection!==own.selection)return;
      own.page=page;renderCycles();
      if(own.cycle)await openCycle(own.cycle.cycle.id,{background:true});
      const latest=own.list.find(value=>value.id===id);
      if(latest&&latest.revision!==own.selected.revision)
        text($('series-edition'),'Selected original edition '+own.selected.revision+' · latest edition '+latest.revision+'. Reopen the series to edit the latest.');
    }
    if(force&&own.agenda)await loadAgenda(own.agenda.offset);
    sync();
  }
  function sync(){
    const selected=Boolean(state.profile),mutating=mutationActive(),saved=isSaved(),closing=Boolean(state.host?.console.closing);
    const ready=selected&&own.ready&&!mutating&&!closing;
    $('series-agenda-load').disabled=!selected||own.agendaLoading;
    $('series-agenda-export').disabled=!selected||own.agendaLoading;
    $('series-agenda-previous').disabled=!own.agenda||own.agenda.offset===0||own.agendaLoading;
    $('series-agenda-next').disabled=!own.agenda||own.agenda.nextOffset===null||own.agendaLoading;
    for(const button of $('series-agenda-rows').querySelectorAll('button'))button.disabled=mutating;
    for(const button of $('series-pending-list').querySelectorAll('[data-series-retry]'))button.disabled=!ready;
    $('series-new').disabled=!selected||mutating;$('series-refresh').disabled=!selected||mutating;
    $('series-save').disabled=!ready||!own.id;$('series-export').disabled=!selected;
    $('series-cycle-new').disabled=!saved||!ready;
    $('series-calendar').disabled=!saved||mutating;$('series-calendar-next').disabled=!saved||mutating;
    $('series-cycle-review').disabled=!saved||!ready;
    $('series-cycle-save').disabled=!ready||!own.review?.packet.review.canStart||own.review.kind!=='cycle';
    $('series-cycle-start').disabled=!ready||!own.review?.packet.review.canStart||own.review.kind!=='start';
    $('series-cycle-start-review').disabled=!ready||!own.cycle||Boolean(own.cycle?.run||own.cycle?.cancellation);
    $('series-cycle-cancel').disabled=!ready||!own.cycle||Boolean(own.cycle?.run||own.cycle?.cancellation);
    const manual=$('series-cadence').value==='manual';
    $('series-interval').disabled=manual;$('series-anchor').disabled=manual;$('series-anchor').required=!manual;
    const latest=own.list.find(value=>value.id===own.selected?.id);
    text($('series-edition'),own.selected?'Original edition '+own.selected.revision+(own.dirty?' · unsaved changes':' · saved')+
      (latest&&latest.revision!==own.selected.revision?' · latest edition '+latest.revision+'; reopen before editing':''):'New customer series');
    text($('series-selected-workflow'),own.selected?
      'Original workflow '+own.selected.workflowId+' / r'+own.selected.workflowRevision+' remains attached to its saved cycles.':
      'Select an existing complete workflow. Saved cycles retain that exact edition.');
  }
  action($('series-new'),()=>editor());action($('series-refresh'),()=>refresh(true));
  action($('series-export'),()=>download('export/'+encodeURIComponent(requireProfile().id),requireProfile().id+'-operator-profile.json'));
  $('series-form').addEventListener('submit',event=>{event.preventDefault();busy(event.submitter,()=>mutate(()=>submitIntent('series-save',seriesBody())));});
  $('series-form').addEventListener('input',changed);
  $('series-form').addEventListener('change',event=>{if(event.target.tagName==='SELECT')changed();});
  action($('series-cycle-new'),()=>newCycle());
  $('series-cycle-form').addEventListener('input',cycleChanged);$('series-cycle-form').addEventListener('change',cycleChanged);
  $('series-cycle-form').addEventListener('submit',event=>{event.preventDefault();busy(event.submitter,reviewCycle);});
  action($('series-cycle-save'),()=>mutate(saveReviewed));action($('series-cycle-start-review'),startReview);
  action($('series-cycle-start'),()=>mutate(startReviewed));
  action($('series-open-run'),()=>openRun(own.cycle.run.id));
  $('series-cycle-cancel-form').addEventListener('submit',event=>{event.preventDefault();busy(event.submitter,()=>mutate(()=>{
    if(!own.cycle)throw new Error('Open a planned period.');
    return submitIntent('series-cycle-cancel',{id:own.cycle.cycle.id,requestId:uid(),reason:$('series-cycle-cancel-reason').value});
  }));});
  $('series-calendar-form').addEventListener('submit',event=>{event.preventDefault();busy(event.submitter,()=>calendar());});
  action($('series-calendar-next'),()=>calendar(true));
  action($('series-cycles-previous'),()=>openSeries(own.selected.id,{revision:own.selected.revision,offset:Math.max(0,own.offset-50)}));
  action($('series-cycles-next'),()=>openSeries(own.selected.id,{revision:own.selected.revision,offset:own.page.nextOffset}));
  $('series-agenda-form').addEventListener('submit',event=>{event.preventDefault();busy(event.submitter,()=>loadAgenda());});
  $('series-agenda-form').addEventListener('input',agendaChanged);
  $('series-agenda-form').addEventListener('change',agendaChanged);
  action($('series-agenda-export'),exportAgenda);
  action($('series-agenda-previous'),()=>loadAgenda(Math.max(0,own.agenda.offset-50)));
  action($('series-agenda-next'),()=>loadAgenda(own.agenda.nextOffset));
  resetAgenda();
  return {refresh,profileChanged,reset,sync};
}
